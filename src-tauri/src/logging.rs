use std::path::Path;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, fmt};

/// Keeps the log-writing thread alive: it must be held for the whole life of the app.
#[allow(dead_code)]
pub struct LogGuard(WorkerGuard);

/// Sets up logging to a file (daily rotation) and to stderr. The level can be changed
/// with the `RUST_LOG` environment variable.
pub fn init(log_dir: &Path) -> LogGuard {
    let _ = std::fs::create_dir_all(log_dir);
    let file = tracing_appender::rolling::daily(log_dir, "disk-analyzer.log");
    let (writer, guard) = tracing_appender::non_blocking(file);

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,disk_analyzer_lib=debug"));

    // try_init: does not fail if a subscriber is already set (e.g. in tests).
    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_writer(writer).with_ansi(false))
        .with(fmt::layer().with_writer(std::io::stderr))
        .try_init();

    LogGuard(guard)
}
