//! Filesystem scan (read-only).
//!
//! Walks the tree in parallel (rayon), skips symlinks and junctions, computes logical size
//! and size on disk, and builds the results tree ([`ScanTree`]).

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

/// Interval between two progress notifications.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
/// How many files of the same folder between updates of the global counters.
const PROGRESS_FLUSH_EVERY: usize = 2048;

// Windows attributes of "cloud-only" files (e.g. OneDrive): they take no space on disk.
const FILE_ATTRIBUTE_OFFLINE: u32 = 0x1000;
const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x40000;
const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x400000;
const CLOUD_ONLY_ATTRIBUTES: u32 =
    FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS;

#[derive(Debug, Clone)]
pub struct ScanOptions {
    /// Cluster size of the volume, used to compute the space taken on disk.
    pub cluster_size: u64,
    /// Files to keep individually for each folder; the others are aggregated.
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

/// Counters read during the scan to report progress.
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
    /// Interrupted by the user; the totals cover what was analyzed up to that point.
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
    /// Folders read so far (root included), to throttle path updates.
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

/// Space taken on disk: size rounded up to clusters. Cloud-only files
/// take no space.
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
            debug!(path = %path.display(), "folder not accessible");
            node.denied = true;
            ctx.counters.denied.fetch_add(1, Ordering::Relaxed);
            return node;
        }
        Err(e) => {
            warn!(path = %path.display(), error = %e, "folder not readable");
            return node;
        }
    };

    let cluster = ctx.opts.cluster_size;
    let mut files: Vec<FileNode> = Vec::new();
    let mut subdirs: Vec<(PathBuf, String)> = Vec::new();
    let mut local_exts: HashMap<String, ExtAcc> = HashMap::new();
    let mut bytes = 0u64;
    // Files and bytes already reported to the global counters: in very large folders they
    // are updated in blocks, so progress keeps moving and cancellation stays responsive.
    let (mut reported_files, mut reported_bytes) = (0u64, 0u64);

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        // Symlinks and junctions are not followed: avoids cycles and double counting.
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
    // Update the displayed path only now and then, to avoid lock contention between threads.
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

    // Keep the largest files, aggregate the rest.
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

/// Normalizes the root: no trailing backslash, except for a drive root (`C:\`).
fn root_label(root: &Path) -> String {
    let s = root.display().to_string();
    if s.len() > 3 {
        s.trim_end_matches('\\').to_string()
    } else {
        s
    }
}

/// Walks `root` and builds its tree. `on_progress` is called from a dedicated thread
/// every [`PROGRESS_INTERVAL`]. Setting `cancel` stops the scan.
pub fn scan(
    root: &Path,
    opts: &ScanOptions,
    cancel: &AtomicBool,
    on_progress: impl Fn(&Snapshot) + Sync,
) -> Result<Outcome, ScanError> {
    if !fs::metadata(root).map_err(classify)?.is_dir() {
        return Err(ScanError::NotADirectory);
    }
    // If the root is not readable it is a scan error, not a "denied" folder.
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
                "(none)".to_string()
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
            Outcome::Cancelled(_) => panic!("expected a completed scan"),
        }
    }

    /// root/
    ///   a/ (f1.mp4: 10 B, f2.txt: 5 B)
    ///   b/c/ (f3.bin: 100 B)
    ///   empty/
    fn sample_tree() -> tempfile::TempDir {
        let dir = tempdir().unwrap();
        let root = dir.path();
        create_dir_all(root.join("a")).unwrap();
        create_dir_all(root.join("b").join("c")).unwrap();
        create_dir_all(root.join("empty")).unwrap();
        write(root.join("a").join("f1.mp4"), [0u8; 10]).unwrap();
        write(root.join("a").join("f2.txt"), [0u8; 5]).unwrap();
        write(root.join("b").join("c").join("f3.bin"), [0u8; 100]).unwrap();
        dir
    }

    #[test]
    fn counts_files_folders_and_bytes() {
        let dir = sample_tree();
        let (tree, totals) = run(dir.path(), &opts());
        assert_eq!((totals.files, totals.dirs, totals.bytes), (3, 4, 115));

        let root = tree.get(tree.root_id()).unwrap();
        assert_eq!((root.files, root.dirs, root.size), (3, 4, 115));
        assert_eq!(root.kind, NodeKind::Dir);
        assert_eq!(root.parent_id, None);
    }

    /// Beyond `PROGRESS_FLUSH_EVERY` files in a folder the counters are updated in blocks:
    /// the totals must neither lose nor duplicate items.
    #[test]
    fn exact_totals_with_large_folders() {
        let dir = tempdir().unwrap();
        let n = PROGRESS_FLUSH_EVERY * 2 + 123; // crosses two block updates
        for i in 0..n {
            write(dir.path().join(format!("f{i}.dat")), [0u8; 3]).unwrap();
        }
        let (tree, totals) = run(dir.path(), &opts());
        assert_eq!(totals.files, n as u64);
        assert_eq!(totals.bytes, 3 * n as u64);

        let root = tree.get(0).unwrap();
        assert_eq!(root.files, n as u64);
        assert_eq!(root.size, 3 * n as u64);
        // The first 50 are kept, the others aggregated.
        let kids = tree.children(0, 1000);
        assert_eq!(kids.len(), 51);
        assert_eq!(kids.last().unwrap().files, n as u64 - 50);
    }

    #[test]
    fn size_on_disk_rounded_to_clusters() {
        let dir = sample_tree();
        let (tree, _) = run(dir.path(), &opts());
        let root = tree.get(0).unwrap();
        // 3 non-empty files: each takes one 4096 B cluster.
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
    fn children_sorted_by_size_with_paths() {
        let dir = sample_tree();
        let (tree, _) = run(dir.path(), &opts());
        let children = tree.children(0, 100);
        let names: Vec<_> = children.iter().map(|n| n.name.as_str()).collect();
        // b (100 B) > a (15 B) > empty (0 B)
        assert_eq!(names, ["b", "a", "empty"]);

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
    fn aggregates_files_beyond_the_limit() {
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
        assert_eq!(kids.len(), 4); // 3 files + the aggregate node
        let agg = kids.last().unwrap();
        assert_eq!(agg.kind, NodeKind::Agg);
        assert_eq!(agg.files, 7);
        assert_eq!(agg.path, root_label(dir.path()));
        // The three largest (19, 18, 17 B) stay; the other 7 (10..=16 B) are aggregated.
        assert_eq!(kids[0].size, 19);
        assert_eq!(agg.size, (10..=16).sum::<u64>());
        // The folder totals also include the aggregated files.
        let root = tree.get(0).unwrap();
        assert_eq!(root.files, 10);
        assert_eq!(root.size, (10..=19).sum::<u64>());
    }

    #[test]
    fn the_children_limit_keeps_the_aggregate_node() {
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
    fn stats_by_type_and_by_extension() {
        let dir = sample_tree();
        let o = ScanOptions {
            keep_files_per_dir: 1,
            ..opts()
        }; // forces aggregation in a/
        let (tree, _) = run(dir.path(), &o);
        let stats = tree.type_stats(10);
        assert_eq!((stats.total_size, stats.total_files), (115, 3));

        let size_of = |t: FileType| stats.types.iter().find(|s| s.file_type == t).unwrap().size;
        assert_eq!(size_of(FileType::Video), 10);
        assert_eq!(size_of(FileType::Doc), 5);
        assert_eq!(size_of(FileType::Other), 100);

        // Extensions also include aggregated files, largest first.
        let exts: Vec<_> = stats
            .exts
            .iter()
            .map(|e| (e.ext.as_str(), e.size))
            .collect();
        assert_eq!(exts, [(".bin", 100), (".mp4", 10), (".txt", 5)]);
        assert_eq!(tree.type_stats(1).exts.len(), 1);
    }

    #[test]
    fn largest_files_with_type_filter() {
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
    fn chain_of_ancestors() {
        let dir = sample_tree();
        let (tree, _) = run(dir.path(), &opts());
        let f3 = tree.top_files(None, 1).remove(0);
        let chain = tree.ancestors(f3.id);
        assert_eq!(chain.len(), 4); // root, b, c, f3
        assert_eq!(chain[0], 0);
        assert_eq!(*chain.last().unwrap(), f3.id);
        assert!(tree.ancestors(9_999_999).is_empty());
        assert!(tree.get(9_999_999).is_none());
    }

    #[test]
    fn cancelled_before_starting() {
        let dir = sample_tree();
        let cancel = AtomicBool::new(true);
        let outcome = scan(dir.path(), &opts(), &cancel, |_| {}).unwrap();
        let Outcome::Cancelled(t) = outcome else {
            panic!("expected a cancelled scan");
        };
        assert_eq!(t.files, 0);
    }

    #[test]
    fn nonexistent_path() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("does-not-exist");
        assert!(matches!(
            scan(&missing, &opts(), &never(), |_| {}),
            Err(ScanError::NotFound)
        ));
    }

    #[test]
    fn path_that_is_not_a_folder() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("file.txt");
        write(&file, b"x").unwrap();
        assert!(matches!(
            scan(&file, &opts(), &never(), |_| {}),
            Err(ScanError::NotADirectory)
        ));
    }

    /// The junction points to `a/`: if it were followed, the files of `a/` would be counted twice.
    #[test]
    fn junction_not_followed() {
        let dir = sample_tree();
        let link = dir.path().join("link");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(dir.path().join("a"))
            .output()
            .unwrap();
        assert!(status.status.success(), "mklink /J failed");

        let (_, totals) = run(dir.path(), &opts());
        assert_eq!((totals.files, totals.bytes), (3, 115));
    }
}
