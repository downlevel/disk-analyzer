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

/// Maximum number of children returned per node (the largest ones).
const MAX_CHILDREN: usize = 5000;
/// Maximum number of nodes requested in a single `get_children` call.
const MAX_BATCH: usize = 200;

fn emit<T: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    if let Err(e) = app.emit(event, payload) {
        warn!(event, error = %e, "failed to emit event");
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

/// If `root` is a whole drive, how many bytes are used: needed to estimate progress.
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
                // The count never reaches 100% before the end: system files
                // and inaccessible ones are not part of the total.
                fraction: expected.map(|e| (snap.bytes as f64 / e as f64).min(0.99)),
            },
        );
    });

    match result {
        Ok(Outcome::Completed { tree, totals }) => {
            let tree = Arc::new(tree);
            let root_node = tree.get(tree.root_id()).expect("the root always exists");
            info!(
                scan_id,
                files = totals.files,
                dirs = totals.dirs,
                bytes = totals.bytes,
                denied = totals.denied,
                nodes = tree.len(),
                elapsed_ms = elapsed(),
                "scan completed"
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
            info!(scan_id, files = t.files, "scan cancelled");
            emit(
                app,
                EVENT_FAILED,
                failed(
                    scan_id,
                    ScanFailureKind::Cancelled,
                    root,
                    "Scan cancelled".into(),
                    &t,
                ),
            );
        }
        Err(e) => {
            let (kind, message) = match &e {
                ScanError::NotFound => (ScanFailureKind::NotFound, "Path not found".to_string()),
                ScanError::NotADirectory => (
                    ScanFailureKind::NotADirectory,
                    "The path is not a folder".to_string(),
                ),
                ScanError::Denied => (ScanFailureKind::Denied, "Access denied".to_string()),
                ScanError::Io(io) => (ScanFailureKind::Io, io.to_string()),
            };
            warn!(scan_id, path = %root.display(), ?kind, %message, "scan failed");
            emit(
                app,
                EVENT_FAILED,
                failed(scan_id, kind, root, message, &Snapshot::default()),
            );
        }
    }
}

/// Starts a scan on a dedicated thread. Progress and outcome arrive as events
/// (`scan:progress`, `scan:done`, `scan:failed`) that carry `scan_id`.
#[tauri::command]
pub fn start_scan(app: AppHandle, registry: State<'_, ScanRegistry>, scan_id: u64, path: String) {
    let cancel = registry.begin(scan_id);
    let root = PathBuf::from(path);
    info!(scan_id, path = %root.display(), "scan started");

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
        warn!(scan_id, error = %e, "unable to start the scan thread");
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

/// Requests cancellation of a scan; the outcome arrives as a `scan:failed` event.
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
        .ok_or_else(|| "Scan results not available".to_string())
}

/// Children of several nodes in a single call, each from largest to smallest.
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

/// Chain of ancestors from the root to the node (included).
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

/// Shows a file (selected) or a folder (opened) in File Explorer.
#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err("Path not found".into());
    }
    let mut cmd = Command::new("explorer.exe");
    if target.is_dir() {
        cmd.arg(target);
    } else {
        // File Explorer wants `/select,"path"` as a single, already quoted string.
        cmd.raw_arg(format!("/select,\"{path}\""));
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Installed desktop apps, read from the Windows registry.
#[tauri::command]
pub fn list_installed_apps(state: State<'_, AppsState>) -> Vec<InstalledApp> {
    let list = apps::list();
    info!(count = list.len(), "installed apps read from the registry");
    state.set_apps(list.clone());
    list
}

/// Measures the folders of the given apps on a dedicated thread (all of them if `ids` is empty).
/// Each result arrives as an `apps:size` event; at the end, `apps:done`. Starting a new
/// measurement cancels the one in progress, without touching disk scans.
#[tauri::command]
pub fn measure_app_sizes(app: AppHandle, state: State<'_, AppsState>, ids: Vec<String>) {
    let cancel = state.begin_measure();
    let mut targets: Vec<InstalledApp> = state
        .apps()
        .into_iter()
        .filter(|a| a.install_location.is_some() && (ids.is_empty() || ids.contains(&a.id)))
        .collect();
    // Largest first (per the registry): the most relevant results arrive right away.
    targets.sort_by_key(|a| std::cmp::Reverse(a.estimated_size.unwrap_or(0)));
    info!(apps = targets.len(), "app measurement started");

    let spawned = std::thread::Builder::new().name("apps-size".into()).spawn({
        let app = app.clone();
        let cancel = cancel.clone();
        move || {
            // Apps sharing a folder (e.g. Office): measured only once.
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
            info!(measured, cancelled, "app measurement finished");
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
        warn!(error = %e, "unable to start the app measurement thread");
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
