use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

use tauri::{AppHandle, Emitter, Manager, State};
use tracing::{info, warn};

use crate::apps;
use crate::model::{
    AppsMeasureDone, ChildrenOf, Drive, EVENT_APP_SIZE, EVENT_APPS_DONE, EVENT_DONE, EVENT_FAILED,
    EVENT_PROGRESS, FileType, InstalledApp, Node, ScanDone, ScanFailed, ScanFailureKind,
    ScanProgress, TypeStats,
};
use crate::scanner::{self, Outcome, ScanError, ScanOptions, Snapshot};
use crate::state::{AppsState, ScanRegistry};
use crate::sys;
use crate::tree::ScanTree;

/// Massimo numero di figli restituiti per nodo (i più grandi).
const MAX_CHILDREN: usize = 5000;
/// Massimo di nodi richiesti in un'unica chiamata a `get_children`.
const MAX_BATCH: usize = 200;

fn emit<T: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    if let Err(e) = app.emit(event, payload) {
        warn!(event, error = %e, "emissione evento non riuscita");
    }
}

fn failed(
    scan_id: u64,
    kind: ScanFailureKind,
    path: &Path,
    message: String,
    totals: &Snapshot,
) -> ScanFailed {
    ScanFailed {
        scan_id,
        kind,
        path: path.display().to_string(),
        message,
        files: totals.files,
        bytes: totals.bytes,
    }
}

/// Se `root` è l'intera unità, quanti byte sono occupati: serve a stimare l'avanzamento.
fn expected_bytes(root: &Path) -> Option<u64> {
    let s = root.to_str()?;
    if s.len() != 3 || !s.ends_with(":\\") {
        return None;
    }
    let (total, free) = sys::volume_space(s)?;
    Some(total.saturating_sub(free)).filter(|&used| used > 0)
}

fn run_scan(
    app: &AppHandle,
    registry: &ScanRegistry,
    scan_id: u64,
    root: &Path,
    cancel: &AtomicBool,
) {
    let started = Instant::now();
    let elapsed = || started.elapsed().as_millis() as u64;

    let opts = ScanOptions {
        cluster_size: sys::cluster_size(root),
        ..ScanOptions::default()
    };
    let expected = expected_bytes(root);

    let result = scanner::scan(root, &opts, cancel, |snap| {
        emit(
            app,
            EVENT_PROGRESS,
            ScanProgress {
                scan_id,
                files: snap.files,
                dirs: snap.dirs,
                bytes: snap.bytes,
                current_path: snap.current.clone(),
                elapsed_ms: elapsed(),
                // Il conteggio non arriva mai al 100% prima della fine: i file di sistema
                // e quelli non accessibili non rientrano nel totale.
                fraction: expected.map(|e| (snap.bytes as f64 / e as f64).min(0.99)),
            },
        );
    });

    match result {
        Ok(Outcome::Completed { tree, totals }) => {
            let tree = Arc::new(tree);
            let root_node = tree.get(tree.root_id()).expect("la radice esiste sempre");
            info!(
                scan_id,
                files = totals.files,
                dirs = totals.dirs,
                bytes = totals.bytes,
                denied = totals.denied,
                nodes = tree.len(),
                elapsed_ms = elapsed(),
                "scansione completata"
            );
            registry.store_result(scan_id, tree);
            emit(
                app,
                EVENT_DONE,
                ScanDone {
                    scan_id,
                    files: totals.files,
                    dirs: totals.dirs,
                    bytes: totals.bytes,
                    denied: totals.denied,
                    elapsed_ms: elapsed(),
                    root: root_node,
                },
            );
        }
        Ok(Outcome::Cancelled(t)) => {
            info!(scan_id, files = t.files, "scansione annullata");
            emit(
                app,
                EVENT_FAILED,
                failed(
                    scan_id,
                    ScanFailureKind::Cancelled,
                    root,
                    "Scansione annullata".into(),
                    &t,
                ),
            );
        }
        Err(e) => {
            let (kind, message) = match &e {
                ScanError::NotFound => (
                    ScanFailureKind::NotFound,
                    "Percorso non trovato".to_string(),
                ),
                ScanError::NotADirectory => (
                    ScanFailureKind::NotADirectory,
                    "Il percorso non è una cartella".to_string(),
                ),
                ScanError::Denied => (ScanFailureKind::Denied, "Accesso negato".to_string()),
                ScanError::Io(io) => (ScanFailureKind::Io, io.to_string()),
            };
            warn!(scan_id, path = %root.display(), ?kind, %message, "scansione non riuscita");
            emit(
                app,
                EVENT_FAILED,
                failed(scan_id, kind, root, message, &Snapshot::default()),
            );
        }
    }
}

/// Avvia una scansione in un thread dedicato. Avanzamento ed esito arrivano come eventi
/// (`scan:progress`, `scan:done`, `scan:failed`) che riportano `scan_id`.
#[tauri::command]
pub fn start_scan(app: AppHandle, registry: State<'_, ScanRegistry>, scan_id: u64, path: String) {
    let cancel = registry.begin(scan_id);
    let root = PathBuf::from(path);
    info!(scan_id, path = %root.display(), "scansione avviata");

    let spawned = std::thread::Builder::new()
        .name(format!("scan-{scan_id}"))
        .spawn({
            let app = app.clone();
            move || {
                let registry = app.state::<ScanRegistry>();
                run_scan(&app, &registry, scan_id, &root, &cancel);
                registry.finish(scan_id);
            }
        });

    if let Err(e) = spawned {
        warn!(scan_id, error = %e, "impossibile avviare il thread di scansione");
        registry.finish(scan_id);
        emit(
            &app,
            EVENT_FAILED,
            ScanFailed {
                scan_id,
                kind: ScanFailureKind::Io,
                path: String::new(),
                message: e.to_string(),
                files: 0,
                bytes: 0,
            },
        );
    }
}

/// Chiede l'annullamento di una scansione; l'esito arriva come evento `scan:failed`.
#[tauri::command]
pub fn cancel_scan(registry: State<'_, ScanRegistry>, scan_id: u64) -> bool {
    registry.cancel(scan_id)
}

#[tauri::command]
pub fn list_drives() -> Vec<Drive> {
    sys::list_drives()
}

fn tree_of(registry: &ScanRegistry, scan_id: u64) -> Result<Arc<ScanTree>, String> {
    registry
        .result(scan_id)
        .ok_or_else(|| "Risultati della scansione non disponibili".to_string())
}

/// Figli di più nodi in un'unica chiamata, ciascuno dal più grande.
#[tauri::command]
pub fn get_children(
    registry: State<'_, ScanRegistry>,
    scan_id: u64,
    ids: Vec<u64>,
) -> Result<Vec<ChildrenOf>, String> {
    let tree = tree_of(&registry, scan_id)?;
    Ok(ids
        .into_iter()
        .take(MAX_BATCH)
        .map(|parent_id| ChildrenOf {
            parent_id,
            children: tree.children(parent_id, MAX_CHILDREN),
        })
        .collect())
}

#[tauri::command]
pub fn get_top_files(
    registry: State<'_, ScanRegistry>,
    scan_id: u64,
    file_type: Option<FileType>,
    limit: usize,
) -> Result<Vec<Node>, String> {
    Ok(tree_of(&registry, scan_id)?.top_files(file_type, limit.min(1000)))
}

#[tauri::command]
pub fn get_type_stats(
    registry: State<'_, ScanRegistry>,
    scan_id: u64,
    ext_limit: usize,
) -> Result<TypeStats, String> {
    Ok(tree_of(&registry, scan_id)?.type_stats(ext_limit.min(1000)))
}

/// Catena di antenati dalla radice al nodo (incluso).
#[tauri::command]
pub fn get_ancestors(
    registry: State<'_, ScanRegistry>,
    scan_id: u64,
    id: u64,
) -> Result<Vec<u64>, String> {
    Ok(tree_of(&registry, scan_id)?.ancestors(id))
}

#[tauri::command]
pub fn get_denied(
    registry: State<'_, ScanRegistry>,
    scan_id: u64,
    limit: usize,
) -> Result<Vec<Node>, String> {
    Ok(tree_of(&registry, scan_id)?.denied(limit.min(1000)))
}

/// Mostra un file (selezionato) o una cartella (aperta) in Esplora risorse.
#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err("Percorso non trovato".into());
    }
    let mut cmd = Command::new("explorer.exe");
    if target.is_dir() {
        cmd.arg(target);
    } else {
        // Esplora risorse vuole `/select,"percorso"` come un'unica stringa già quotata.
        cmd.raw_arg(format!("/select,\"{path}\""));
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// App desktop installate, lette dal registro di Windows.
#[tauri::command]
pub fn list_installed_apps(state: State<'_, AppsState>) -> Vec<InstalledApp> {
    let list = apps::list();
    info!(count = list.len(), "app installate lette dal registro");
    state.set_apps(list.clone());
    list
}

/// Misura in un thread dedicato le cartelle delle app indicate (tutte, se `ids` è vuoto).
/// Ogni risultato arriva come evento `apps:size`; alla fine `apps:done`. Avviare una nuova
/// misurazione annulla quella in corso, senza toccare le scansioni dei dischi.
#[tauri::command]
pub fn measure_app_sizes(app: AppHandle, state: State<'_, AppsState>, ids: Vec<String>) {
    let cancel = state.begin_measure();
    let mut targets: Vec<InstalledApp> = state
        .apps()
        .into_iter()
        .filter(|a| a.install_location.is_some() && (ids.is_empty() || ids.contains(&a.id)))
        .collect();
    // Le più grandi (secondo il registro) per prime: i risultati più rilevanti arrivano subito.
    targets.sort_by_key(|a| std::cmp::Reverse(a.estimated_size.unwrap_or(0)));
    info!(apps = targets.len(), "misura delle app avviata");

    let spawned = std::thread::Builder::new().name("apps-size".into()).spawn({
        let app = app.clone();
        let cancel = cancel.clone();
        move || {
            // App con la stessa cartella (es. Office): si misura una volta sola.
            let mut by_path: Vec<(String, Vec<&InstalledApp>)> = Vec::new();
            for a in &targets {
                let key = a
                    .install_location
                    .clone()
                    .unwrap_or_default()
                    .to_lowercase();
                match by_path.iter_mut().find(|(k, _)| *k == key) {
                    Some((_, group)) => group.push(a),
                    None => by_path.push((key, vec![a])),
                }
            }

            let mut measured = 0u64;
            let mut cancelled = false;
            for (_, group) in &by_path {
                let path = group[0].install_location.clone().unwrap_or_default();
                let Some(size) = apps::measure(&group[0].id, &path, &cancel) else {
                    cancelled = true;
                    break;
                };
                for a in group {
                    emit(
                        &app,
                        EVENT_APP_SIZE,
                        crate::model::AppSize {
                            id: a.id.clone(),
                            ..size.clone()
                        },
                    );
                    measured += 1;
                }
            }
            info!(measured, cancelled, "misura delle app terminata");
            emit(
                &app,
                EVENT_APPS_DONE,
                AppsMeasureDone {
                    measured,
                    total: targets.len() as u64,
                    cancelled,
                },
            );
            app.state::<AppsState>().finish_measure(&cancel);
        }
    });
    if let Err(e) = spawned {
        warn!(error = %e, "impossibile avviare il thread di misura delle app");
        state.finish_measure(&cancel);
        emit(
            &app,
            EVENT_APPS_DONE,
            AppsMeasureDone {
                measured: 0,
                total: 0,
                cancelled: true,
            },
        );
    }
}

#[tauri::command]
pub fn cancel_app_sizes(state: State<'_, AppsState>) -> bool {
    state.cancel_measure()
}
