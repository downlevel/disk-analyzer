mod apps;
mod commands;
mod filetype;
mod logging;
pub mod model;
mod scanner;
mod state;
mod sys;
mod tree;

use tauri::Manager;
use tracing::info;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state::ScanRegistry::default())
        .manage(state::AppsState::default())
        .setup(|app| {
            let log_dir = app.path().app_log_dir()?;
            let guard = logging::init(&log_dir);
            app.manage(guard);
            info!(log_dir = %log_dir.display(), "Disk Analyzer started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_scan,
            commands::cancel_scan,
            commands::list_drives,
            commands::get_children,
            commands::get_top_files,
            commands::get_type_stats,
            commands::get_ancestors,
            commands::get_denied,
            commands::open_in_explorer,
            commands::list_installed_apps,
            commands::measure_app_sizes,
            commands::cancel_app_sizes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
