use std::path::Path;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, fmt};

/// Mantiene attivo il thread di scrittura dei log: va conservato per tutta la vita dell'app.
#[allow(dead_code)]
pub struct LogGuard(WorkerGuard);

/// Imposta il logging su file (rotazione giornaliera) e su stderr. Il livello si può cambiare
/// con la variabile d'ambiente `RUST_LOG`.
pub fn init(log_dir: &Path) -> LogGuard {
    let _ = std::fs::create_dir_all(log_dir);
    let file = tracing_appender::rolling::daily(log_dir, "disk-analyzer.log");
    let (writer, guard) = tracing_appender::non_blocking(file);

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,disk_analyzer_lib=debug"));

    // try_init: non fallisce se un subscriber è già impostato (es. nei test).
    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_writer(writer).with_ansi(false))
        .with(fmt::layer().with_writer(std::io::stderr))
        .try_init();

    LogGuard(guard)
}
