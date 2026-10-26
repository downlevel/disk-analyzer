//! Tipi condivisi con il frontend.
//!
//! I binding TypeScript vengono generati da `ts-rs` in `src/bindings` eseguendo `cargo test`.
//! I campi numerici sono `u64` lato Rust ma `number` lato TypeScript (le dimensioni restano
//! ampiamente sotto 2^53 byte).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Nome degli eventi emessi verso il frontend.
pub const EVENT_PROGRESS: &str = "scan:progress";
pub const EVENT_DONE: &str = "scan:done";
pub const EVENT_FAILED: &str = "scan:failed";
pub const EVENT_APP_SIZE: &str = "apps:size";
pub const EVENT_APPS_DONE: &str = "apps:done";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum FileType {
    Video,
    Img,
    Doc,
    Code,
    Arch,
    Other,
}

impl FileType {
    pub const ALL: [FileType; 6] = [
        FileType::Video,
        FileType::Img,
        FileType::Doc,
        FileType::Code,
        FileType::Arch,
        FileType::Other,
    ];

    /// Posizione nei vettori per tipo.
    pub fn index(self) -> usize {
        self as usize
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum NodeKind {
    Dir,
    File,
    /// Nodo sintetico che raggruppa i file di una cartella con molti elementi.
    Agg,
    /// Cartella non accessibile (permesso negato).
    Denied,
}

/// Byte per tipo di file.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct TypeBreakdown {
    #[ts(type = "number")]
    pub video: u64,
    #[ts(type = "number")]
    pub img: u64,
    #[ts(type = "number")]
    pub doc: u64,
    #[ts(type = "number")]
    pub code: u64,
    #[ts(type = "number")]
    pub arch: u64,
    #[ts(type = "number")]
    pub other: u64,
}

impl From<[u64; 6]> for TypeBreakdown {
    fn from(v: [u64; 6]) -> Self {
        TypeBreakdown {
            video: v[FileType::Video.index()],
            img: v[FileType::Img.index()],
            doc: v[FileType::Doc.index()],
            code: v[FileType::Code.index()],
            arch: v[FileType::Arch.index()],
            other: v[FileType::Other.index()],
        }
    }
}

/// Elemento dell'albero delle cartelle. Il frontend lo richiede a livelli, a mano a mano che
/// l'utente espande le cartelle: l'albero completo resta in memoria lato Rust.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Node {
    #[ts(type = "number")]
    pub id: u64,
    #[ts(type = "number | null")]
    pub parent_id: Option<u64>,
    /// Vuoto per i nodi aggregati (il frontend compone "File (N)").
    pub name: String,
    /// Percorso completo; per i nodi aggregati è quello della cartella che li contiene.
    pub path: String,
    pub kind: NodeKind,
    /// Dimensione logica in byte.
    #[ts(type = "number")]
    pub size: u64,
    /// Dimensione su disco in byte.
    #[ts(type = "number")]
    pub disk: u64,
    #[ts(type = "number")]
    pub files: u64,
    #[ts(type = "number")]
    pub dirs: u64,
    pub file_type: Option<FileType>,
    pub ext: Option<String>,
    pub modified: Option<String>,
    pub child_count: u32,
    pub by_type: TypeBreakdown,
}

/// Figli di un nodo, dal più grande al più piccolo.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChildrenOf {
    #[ts(type = "number")]
    pub parent_id: u64,
    pub children: Vec<Node>,
}

/// Unità disco.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Drive {
    /// Lettera senza due punti (es. "C").
    pub key: String,
    /// Lettera con due punti (es. "C:").
    pub letter: String,
    pub name: String,
    pub kind: String,
    /// Percorso radice (es. "C:\").
    pub path: String,
    #[ts(type = "number")]
    pub total: u64,
    #[ts(type = "number")]
    pub used: u64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TypeStat {
    pub file_type: FileType,
    #[ts(type = "number")]
    pub size: u64,
    #[ts(type = "number")]
    pub files: u64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExtStat {
    pub ext: String,
    pub file_type: FileType,
    #[ts(type = "number")]
    pub size: u64,
    #[ts(type = "number")]
    pub files: u64,
}

/// Ripartizione dello spazio per tipo di file e per estensione.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TypeStats {
    pub types: Vec<TypeStat>,
    pub exts: Vec<ExtStat>,
    #[ts(type = "number")]
    pub total_size: u64,
    #[ts(type = "number")]
    pub total_files: u64,
}

/// Avanzamento di una scansione in corso.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScanProgress {
    #[ts(type = "number")]
    pub scan_id: u64,
    #[ts(type = "number")]
    pub files: u64,
    #[ts(type = "number")]
    pub dirs: u64,
    #[ts(type = "number")]
    pub bytes: u64,
    pub current_path: String,
    #[ts(type = "number")]
    pub elapsed_ms: u64,
    /// Frazione completata (0..1), se stimabile (solo per le scansioni di un'intera unità).
    pub fraction: Option<f64>,
}

/// Scansione completata.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScanDone {
    #[ts(type = "number")]
    pub scan_id: u64,
    #[ts(type = "number")]
    pub files: u64,
    #[ts(type = "number")]
    pub dirs: u64,
    #[ts(type = "number")]
    pub bytes: u64,
    /// Cartelle che non è stato possibile leggere (permesso negato).
    #[ts(type = "number")]
    pub denied: u64,
    #[ts(type = "number")]
    pub elapsed_ms: u64,
    pub root: Node,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ScanFailureKind {
    NotFound,
    NotADirectory,
    Denied,
    Cancelled,
    Io,
}

/// Scansione non completata: errore o annullamento. Per l'annullamento `files` e `bytes`
/// riportano quanto era stato analizzato.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScanFailed {
    #[ts(type = "number")]
    pub scan_id: u64,
    pub kind: ScanFailureKind,
    pub path: String,
    pub message: String,
    #[ts(type = "number")]
    pub files: u64,
    #[ts(type = "number")]
    pub bytes: u64,
}

/// Da dove proviene la voce nel registro di Windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum AppScope {
    /// Installata per tutti gli utenti (64 bit).
    Machine,
    /// Installata per tutti gli utenti (32 bit).
    Machine32,
    /// Installata per l'utente corrente.
    User,
}

/// App desktop installata, come risulta dal registro di Windows.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct InstalledApp {
    /// Identificativo stabile: ambito e nome della chiave di registro.
    pub id: String,
    pub name: String,
    pub version: Option<String>,
    pub publisher: Option<String>,
    /// Cartella di installazione, se nota.
    pub install_location: Option<String>,
    /// La cartella non è dichiarata dall'app: è stata ricavata dall'icona o dal disinstallatore.
    pub location_derived: bool,
    /// Più app dichiarano la stessa cartella (es. le app di Office): la dimensione è condivisa.
    pub shared_location: bool,
    /// Dimensione dichiarata dall'app nel registro, in byte (spesso assente o approssimativa).
    #[ts(type = "number | null")]
    pub estimated_size: Option<u64>,
    pub install_date: Option<String>,
    pub scope: AppScope,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SizeStatus {
    Measured,
    /// La cartella non esiste più.
    Missing,
    Denied,
    Failed,
}

/// Dimensione misurata della cartella di un'app.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppSize {
    pub id: String,
    pub status: SizeStatus,
    pub path: String,
    #[ts(type = "number")]
    pub size: u64,
    #[ts(type = "number")]
    pub disk: u64,
    #[ts(type = "number")]
    pub files: u64,
}

/// Fine della misurazione delle app.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppsMeasureDone {
    #[ts(type = "number")]
    pub measured: u64,
    #[ts(type = "number")]
    pub total: u64,
    pub cancelled: bool,
}
