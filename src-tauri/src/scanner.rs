//! Scansione del filesystem (sola lettura).
//!
//! Percorre l'albero in parallelo (rayon), salta symlink e junction, calcola dimensione logica
//! e su disco e costruisce l'albero dei risultati ([`ScanTree`]).

use std::collections::HashMap;
use std::fs;
use std::io;
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant, UNIX_EPOCH};

use rayon::prelude::*;
use tracing::{debug, warn};

use crate::filetype::{ext_of, type_for_ext};
use crate::model::FileType;
use crate::sys::DEFAULT_CLUSTER_SIZE;
use crate::tree::{Agg, DirNode, ExtTotal, FileNode, ScanTree};

/// Intervallo tra due notifiche di avanzamento.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
/// Ogni quanti file di una stessa cartella si aggiornano i contatori globali.
const PROGRESS_FLUSH_EVERY: usize = 2048;

// Attributi Windows dei file "solo nel cloud" (es. OneDrive): non occupano spazio su disco.
const FILE_ATTRIBUTE_OFFLINE: u32 = 0x1000;
const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x40000;
const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x400000;
const CLOUD_ONLY_ATTRIBUTES: u32 =
    FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS;

#[derive(Debug, Clone)]
pub struct ScanOptions {
    /// Dimensione del cluster del volume, per calcolare lo spazio occupato su disco.
    pub cluster_size: u64,
    /// File da conservare singolarmente per ogni cartella; gli altri vengono aggregati.
    pub keep_files_per_dir: usize,
    pub threads: usize,
}

impl Default for ScanOptions {
    fn default() -> Self {
        ScanOptions {
            cluster_size: DEFAULT_CLUSTER_SIZE,
            keep_files_per_dir: 50,
            threads: 8,
        }
    }
}

/// Contatori letti durante la scansione per l'avanzamento.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Snapshot {
    pub files: u64,
    pub dirs: u64,
    pub bytes: u64,
    pub denied: u64,
    pub current: String,
}

pub enum Outcome {
    Completed {
        tree: ScanTree,
        totals: Snapshot,
    },
    /// Interrotta dall'utente; i totali riguardano quanto analizzato fino a quel momento.
    Cancelled(Snapshot),
}

#[derive(Debug)]
pub enum ScanError {
    NotFound,
    NotADirectory,
    Denied,
    Io(io::Error),
}

fn classify(e: io::Error) -> ScanError {
    match e.kind() {
        io::ErrorKind::NotFound => ScanError::NotFound,
        io::ErrorKind::PermissionDenied => ScanError::Denied,
        _ => ScanError::Io(e),
    }
}

#[derive(Default)]
struct Counters {
    files: AtomicU64,
    dirs: AtomicU64,
    bytes: AtomicU64,
    denied: AtomicU64,
    /// Cartelle lette finora (la radice compresa), per limitare gli aggiornamenti del percorso.
    visited: AtomicU64,
}

#[derive(Default)]
struct ExtAcc {
    size: u64,
    files: u64,
}

struct Ctx<'a> {
    cancel: &'a AtomicBool,
    opts: &'a ScanOptions,
    counters: Counters,
    exts: Mutex<HashMap<String, ExtAcc>>,
    current: Mutex<String>,
}

impl Ctx<'_> {
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            files: self.counters.files.load(Ordering::Relaxed),
            dirs: self.counters.dirs.load(Ordering::Relaxed),
            bytes: self.counters.bytes.load(Ordering::Relaxed),
            denied: self.counters.denied.load(Ordering::Relaxed),
            current: self.current.lock().map(|c| c.clone()).unwrap_or_default(),
        }
    }
}

/// Spazio occupato su disco: dimensione arrotondata ai cluster. I file presenti solo nel cloud
/// non occupano spazio.
fn disk_size(attributes: u32, size: u64, cluster: u64) -> u64 {
    if size == 0 || attributes & CLOUD_ONLY_ATTRIBUTES != 0 {
        return 0;
    }
    size.div_ceil(cluster) * cluster
}

fn scan_dir(path: &Path, name: String, ctx: &Ctx) -> DirNode {
    let mut node = DirNode::new(name);
    if ctx.cancel.load(Ordering::Relaxed) {
        return node;
    }

    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
            debug!(path = %path.display(), "cartella non accessibile");
            node.denied = true;
            ctx.counters.denied.fetch_add(1, Ordering::Relaxed);
            return node;
        }
        Err(e) => {
            warn!(path = %path.display(), error = %e, "cartella non leggibile");
            return node;
        }
    };

    let cluster = ctx.opts.cluster_size;
    let mut files: Vec<FileNode> = Vec::new();
    let mut subdirs: Vec<(PathBuf, String)> = Vec::new();
    let mut local_exts: HashMap<String, ExtAcc> = HashMap::new();
    let mut bytes = 0u64;
    // File e byte già riportati ai contatori globali: nelle cartelle molto grandi li si
    // aggiorna a blocchi, così l'avanzamento procede e l'annullamento è reattivo.
    let (mut reported_files, mut reported_bytes) = (0u64, 0u64);

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        // Symlink e junction non vengono seguiti: evitano cicli e doppi conteggi.
        if file_type.is_symlink() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if file_type.is_dir() {
            subdirs.push((entry.path(), file_name));
        } else if file_type.is_file() {
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let size = meta.len();
            let ext = ext_of(&file_name);
            let ftype = type_for_ext(ext.trim_start_matches('.'));
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_secs() as i64);
            let acc = local_exts.entry(ext).or_default();
            acc.size += size;
            acc.files += 1;
            bytes += size;
            files.push(FileNode {
                name: file_name,
                size,
                disk: disk_size(meta.file_attributes(), size, cluster),
                ftype,
                modified,
            });

            if files.len().is_multiple_of(PROGRESS_FLUSH_EVERY) {
                let n = files.len() as u64;
                ctx.counters
                    .files
                    .fetch_add(n - reported_files, Ordering::Relaxed);
                ctx.counters
                    .bytes
                    .fetch_add(bytes - reported_bytes, Ordering::Relaxed);
                (reported_files, reported_bytes) = (n, bytes);
                if let Ok(mut current) = ctx.current.try_lock() {
                    *current = path.display().to_string();
                }
                if ctx.cancel.load(Ordering::Relaxed) {
                    break;
                }
            }
        }
    }

    ctx.counters
        .files
        .fetch_add(files.len() as u64 - reported_files, Ordering::Relaxed);
    ctx.counters
        .bytes
        .fetch_add(bytes - reported_bytes, Ordering::Relaxed);
    ctx.counters
        .dirs
        .fetch_add(subdirs.len() as u64, Ordering::Relaxed);
    // Aggiorna il percorso mostrato solo ogni tanto, per non contendere il lock tra i thread.
    let visited = ctx.counters.visited.fetch_add(1, Ordering::Relaxed);
    if visited.is_multiple_of(8)
        && let Ok(mut current) = ctx.current.try_lock()
    {
        *current = path.display().to_string();
    }
    if !local_exts.is_empty() {
        let mut global = ctx.exts.lock().unwrap_or_else(|e| e.into_inner());
        for (ext, acc) in local_exts {
            let g = global.entry(ext).or_default();
            g.size += acc.size;
            g.files += acc.files;
        }
    }

    // Conserva i file più grandi, aggrega il resto.
    let keep = ctx.opts.keep_files_per_dir;
    if files.len() > keep {
        files.sort_unstable_by_key(|f| std::cmp::Reverse(f.size));
        let mut agg = Agg::default();
        for f in files.drain(keep..) {
            agg.size += f.size;
            agg.disk += f.disk;
            agg.files += 1;
            agg.by_type[f.ftype.index()] += f.size;
        }
        node.agg = Some(agg);
    }

    for f in &files {
        node.size += f.size;
        node.disk += f.disk;
        node.total_files += 1;
        node.by_type[f.ftype.index()] += f.size;
    }
    if let Some(agg) = &node.agg {
        node.size += agg.size;
        node.disk += agg.disk;
        node.total_files += agg.files;
        for (acc, v) in node.by_type.iter_mut().zip(agg.by_type) {
            *acc += v;
        }
    }
    node.files = files;

    let children: Vec<DirNode> = subdirs
        .par_iter()
        .map(|(p, n)| scan_dir(p, n.clone(), ctx))
        .collect();
    for child in &children {
        node.size += child.size;
        node.disk += child.disk;
        node.total_files += child.total_files;
        node.total_dirs += 1 + child.total_dirs;
        for (acc, v) in node.by_type.iter_mut().zip(child.by_type) {
            *acc += v;
        }
    }
    node.dirs = children;
    node
}

/// Normalizza la radice: senza backslash finale, tranne per la radice di un'unità (`C:\`).
fn root_label(root: &Path) -> String {
    let s = root.display().to_string();
    if s.len() > 3 {
        s.trim_end_matches('\\').to_string()
    } else {
        s
    }
}

/// Percorre `root` e ne costruisce l'albero. `on_progress` viene chiamata da un thread dedicato
/// ogni [`PROGRESS_INTERVAL`]. Impostando `cancel` la scansione si ferma.
pub fn scan(
    root: &Path,
    opts: &ScanOptions,
    cancel: &AtomicBool,
    on_progress: impl Fn(&Snapshot) + Sync,
) -> Result<Outcome, ScanError> {
    if !fs::metadata(root).map_err(classify)?.is_dir() {
        return Err(ScanError::NotADirectory);
    }
    // Se la radice non è leggibile è un errore della scansione, non una cartella "negata".
    fs::read_dir(root).map_err(classify)?;

    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(opts.threads.max(1))
        .stack_size(16 * 1024 * 1024)
        .thread_name(|i| format!("scan-worker-{i}"))
        .build()
        .map_err(|e| ScanError::Io(io::Error::other(e)))?;

    let label = root_label(root);
    let ctx = Ctx {
        cancel,
        opts,
        counters: Counters::default(),
        exts: Mutex::new(HashMap::new()),
        current: Mutex::new(label.clone()),
    };

    let done = AtomicBool::new(false);
    let started = Instant::now();
    let dir = std::thread::scope(|s| {
        let reporter = s.spawn(|| {
            let mut last = started;
            while !done.load(Ordering::Acquire) {
                std::thread::park_timeout(PROGRESS_INTERVAL);
                if last.elapsed() >= PROGRESS_INTERVAL && !done.load(Ordering::Acquire) {
                    on_progress(&ctx.snapshot());
                    last = Instant::now();
                }
            }
        });
        let dir = pool.install(|| scan_dir(root, label.clone(), &ctx));
        done.store(true, Ordering::Release);
        reporter.thread().unpark();
        dir
    });

    let totals = ctx.snapshot();
    if cancel.load(Ordering::Relaxed) {
        return Ok(Outcome::Cancelled(totals));
    }

    let mut exts: Vec<ExtTotal> = ctx
        .exts
        .into_inner()
        .unwrap_or_else(|e| e.into_inner())
        .into_iter()
        .map(|(ext, acc)| {
            let ftype: FileType = type_for_ext(ext.trim_start_matches('.'));
            let ext = if ext.is_empty() {
                "(nessuna)".to_string()
            } else {
                ext
            };
            ExtTotal {
                ext,
                ftype,
                size: acc.size,
                files: acc.files,
            }
        })
        .collect();
    exts.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.ext.cmp(&b.ext)));

    let tree = ScanTree::build(label, dir, exts);
    Ok(Outcome::Completed { tree, totals })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::NodeKind;
    use std::fs::{create_dir_all, write};
    use tempfile::tempdir;

    fn never() -> AtomicBool {
        AtomicBool::new(false)
    }

    fn opts() -> ScanOptions {
        ScanOptions {
            cluster_size: 4096,
            keep_files_per_dir: 50,
            threads: 2,
        }
    }

    fn run(root: &Path, opts: &ScanOptions) -> (ScanTree, Snapshot) {
        match scan(root, opts, &never(), |_| {}).unwrap() {
            Outcome::Completed { tree, totals } => (tree, totals),
            Outcome::Cancelled(_) => panic!("attesa scansione completata"),
        }
    }

    /// root/
    ///   a/ (f1.mp4: 10 B, f2.txt: 5 B)
    ///   b/c/ (f3.bin: 100 B)
    ///   vuota/
    fn sample_tree() -> tempfile::TempDir {
        let dir = tempdir().unwrap();
        let root = dir.path();
        create_dir_all(root.join("a")).unwrap();
        create_dir_all(root.join("b").join("c")).unwrap();
        create_dir_all(root.join("vuota")).unwrap();
        write(root.join("a").join("f1.mp4"), [0u8; 10]).unwrap();
        write(root.join("a").join("f2.txt"), [0u8; 5]).unwrap();
        write(root.join("b").join("c").join("f3.bin"), [0u8; 100]).unwrap();
        dir
    }

    #[test]
    fn conta_file_cartelle_e_byte() {
        let dir = sample_tree();
        let (tree, totals) = run(dir.path(), &opts());
        assert_eq!((totals.files, totals.dirs, totals.bytes), (3, 4, 115));

        let root = tree.get(tree.root_id()).unwrap();
        assert_eq!((root.files, root.dirs, root.size), (3, 4, 115));
        assert_eq!(root.kind, NodeKind::Dir);
        assert_eq!(root.parent_id, None);
    }

    /// Oltre `PROGRESS_FLUSH_EVERY` file in una cartella i contatori vengono aggiornati a blocchi:
    /// i totali non devono né perdere né duplicare elementi.
    #[test]
    fn totali_esatti_con_cartelle_grandi() {
        let dir = tempdir().unwrap();
        let n = PROGRESS_FLUSH_EVERY * 2 + 123; // attraversa due aggiornamenti a blocchi
        for i in 0..n {
            write(dir.path().join(format!("f{i}.dat")), [0u8; 3]).unwrap();
        }
        let (tree, totals) = run(dir.path(), &opts());
        assert_eq!(totals.files, n as u64);
        assert_eq!(totals.bytes, 3 * n as u64);

        let root = tree.get(0).unwrap();
        assert_eq!(root.files, n as u64);
        assert_eq!(root.size, 3 * n as u64);
        // Conservati i primi 50, gli altri aggregati.
        let kids = tree.children(0, 1000);
        assert_eq!(kids.len(), 51);
        assert_eq!(kids.last().unwrap().files, n as u64 - 50);
    }

    #[test]
    fn dimensione_su_disco_arrotondata_ai_cluster() {
        let dir = sample_tree();
        let (tree, _) = run(dir.path(), &opts());
        let root = tree.get(0).unwrap();
        // 3 file non vuoti: ciascuno occupa un cluster da 4096 B.
        assert_eq!(root.disk, 3 * 4096);
        assert_eq!(disk_size(0, 0, 4096), 0);
        assert_eq!(disk_size(0, 4096, 4096), 4096);
        assert_eq!(disk_size(0, 4097, 4096), 8192);
        assert_eq!(
            disk_size(FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS, 5000, 4096),
            0
        );
    }

    #[test]
    fn figli_ordinati_per_dimensione_e_percorsi() {
        let dir = sample_tree();
        let (tree, _) = run(dir.path(), &opts());
        let children = tree.children(0, 100);
        let names: Vec<_> = children.iter().map(|n| n.name.as_str()).collect();
        // b (100 B) > a (15 B) > vuota (0 B)
        assert_eq!(names, ["b", "a", "vuota"]);

        let b = &children[0];
        assert_eq!(b.path, format!("{}\\b", root_label(dir.path())));
        assert_eq!(b.parent_id, Some(0));

        let a_children = tree.children(children[1].id, 100);
        assert_eq!(a_children.len(), 2);
        assert_eq!(a_children[0].name, "f1.mp4");
        assert_eq!(a_children[0].ext.as_deref(), Some(".mp4"));
        assert_eq!(a_children[0].file_type, Some(FileType::Video));
        assert!(a_children[0].path.ends_with("a\\f1.mp4"));
        assert!(a_children[0].modified.is_some());
    }

    #[test]
    fn aggrega_i_file_oltre_il_limite() {
        let dir = tempdir().unwrap();
        for i in 0..10u8 {
            write(
                dir.path().join(format!("f{i}.txt")),
                vec![0u8; 10 + usize::from(i)],
            )
            .unwrap();
        }
        let o = ScanOptions {
            keep_files_per_dir: 3,
            ..opts()
        };
        let (tree, totals) = run(dir.path(), &o);
        assert_eq!(totals.files, 10);

        let kids = tree.children(0, 100);
        assert_eq!(kids.len(), 4); // 3 file + il nodo aggregato
        let agg = kids.last().unwrap();
        assert_eq!(agg.kind, NodeKind::Agg);
        assert_eq!(agg.files, 7);
        assert_eq!(agg.path, root_label(dir.path()));
        // I tre più grandi (19, 18, 17 B) restano; gli altri 7 (10..=16 B) sono aggregati.
        assert_eq!(kids[0].size, 19);
        assert_eq!(agg.size, (10..=16).sum::<u64>());
        // I totali della cartella comprendono anche i file aggregati.
        let root = tree.get(0).unwrap();
        assert_eq!(root.files, 10);
        assert_eq!(root.size, (10..=19).sum::<u64>());
    }

    #[test]
    fn il_limite_sui_figli_conserva_il_nodo_aggregato() {
        let dir = tempdir().unwrap();
        for i in 0..6u8 {
            write(
                dir.path().join(format!("f{i}.txt")),
                vec![0u8; 10 + usize::from(i)],
            )
            .unwrap();
        }
        let o = ScanOptions {
            keep_files_per_dir: 4,
            ..opts()
        };
        let (tree, _) = run(dir.path(), &o);
        let kids = tree.children(0, 2);
        assert_eq!(kids.len(), 3);
        assert_eq!(kids.last().unwrap().kind, NodeKind::Agg);
    }

    #[test]
    fn statistiche_per_tipo_e_per_estensione() {
        let dir = sample_tree();
        let o = ScanOptions {
            keep_files_per_dir: 1,
            ..opts()
        }; // forza l'aggregazione in a/
        let (tree, _) = run(dir.path(), &o);
        let stats = tree.type_stats(10);
        assert_eq!((stats.total_size, stats.total_files), (115, 3));

        let size_of = |t: FileType| stats.types.iter().find(|s| s.file_type == t).unwrap().size;
        assert_eq!(size_of(FileType::Video), 10);
        assert_eq!(size_of(FileType::Doc), 5);
        assert_eq!(size_of(FileType::Other), 100);

        // Le estensioni comprendono anche i file aggregati, dalla più grande.
        let exts: Vec<_> = stats
            .exts
            .iter()
            .map(|e| (e.ext.as_str(), e.size))
            .collect();
        assert_eq!(exts, [(".bin", 100), (".mp4", 10), (".txt", 5)]);
        assert_eq!(tree.type_stats(1).exts.len(), 1);
    }

    #[test]
    fn file_piu_grandi_con_filtro_per_tipo() {
        let dir = sample_tree();
        let (tree, _) = run(dir.path(), &opts());
        let all = tree.top_files(None, 10);
        let names: Vec<_> = all.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, ["f3.bin", "f1.mp4", "f2.txt"]);
        assert_eq!(tree.top_files(None, 2).len(), 2);

        let video = tree.top_files(Some(FileType::Video), 10);
        assert_eq!(video.len(), 1);
        assert_eq!(video[0].name, "f1.mp4");
    }

    #[test]
    fn catena_degli_antenati() {
        let dir = sample_tree();
        let (tree, _) = run(dir.path(), &opts());
        let f3 = tree.top_files(None, 1).remove(0);
        let chain = tree.ancestors(f3.id);
        assert_eq!(chain.len(), 4); // radice, b, c, f3
        assert_eq!(chain[0], 0);
        assert_eq!(*chain.last().unwrap(), f3.id);
        assert!(tree.ancestors(9_999_999).is_empty());
        assert!(tree.get(9_999_999).is_none());
    }

    #[test]
    fn annullata_prima_di_iniziare() {
        let dir = sample_tree();
        let cancel = AtomicBool::new(true);
        let outcome = scan(dir.path(), &opts(), &cancel, |_| {}).unwrap();
        let Outcome::Cancelled(t) = outcome else {
            panic!("attesa scansione annullata");
        };
        assert_eq!(t.files, 0);
    }

    #[test]
    fn percorso_inesistente() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("non-esiste");
        assert!(matches!(
            scan(&missing, &opts(), &never(), |_| {}),
            Err(ScanError::NotFound)
        ));
    }

    #[test]
    fn percorso_che_non_e_una_cartella() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("file.txt");
        write(&file, b"x").unwrap();
        assert!(matches!(
            scan(&file, &opts(), &never(), |_| {}),
            Err(ScanError::NotADirectory)
        ));
    }

    /// La junction punta a `a/`: se venisse seguita i file di `a/` sarebbero contati due volte.
    #[test]
    fn junction_non_seguita() {
        let dir = sample_tree();
        let link = dir.path().join("collegamento");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(dir.path().join("a"))
            .output()
            .unwrap();
        assert!(status.status.success(), "mklink /J fallito");

        let (_, totals) = run(dir.path(), &opts());
        assert_eq!((totals.files, totals.bytes), (3, 115));
    }
}
