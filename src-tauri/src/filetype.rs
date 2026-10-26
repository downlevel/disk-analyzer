//! Classificazione dei file per estensione e formattazione delle date.

use crate::model::FileType;

/// Tipo di file a partire dall'estensione (minuscola, senza punto).
pub fn type_for_ext(ext: &str) -> FileType {
    match ext {
        // ".ts" è anche un formato video (MPEG transport stream), ma sui PC di sviluppo
        // è quasi sempre TypeScript: lo classifichiamo come codice.
        "mp4" | "mkv" | "mov" | "avi" | "wmv" | "webm" | "m4v" | "flv" | "mpg" | "mpeg"
        | "m2ts" => FileType::Video,
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp" | "heic" | "heif" | "raw" | "cr2"
        | "cr3" | "nef" | "arw" | "dng" | "tif" | "tiff" | "psd" | "svg" | "ico" => FileType::Img,
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "md" | "csv" | "odt"
        | "ods" | "odp" | "rtf" | "pst" | "ost" => FileType::Doc,
        "js" | "jsx" | "ts" | "tsx" | "mts" | "cts" | "mjs" | "py" | "rs" | "java" | "jar"
        | "c" | "cpp" | "h" | "hpp" | "cs" | "go" | "rb" | "php" | "html" | "css" | "scss"
        | "json" | "xml" | "yaml" | "yml" | "toml" | "sh" | "ps1" | "bat" | "sql" | "kt"
        | "swift" | "lua" | "pdb" => FileType::Code,
        "zip" | "7z" | "rar" | "tar" | "gz" | "tgz" | "bz2" | "xz" | "zst" | "iso" | "msi"
        | "cab" | "img" | "vhd" | "vhdx" | "vmdk" | "wim" | "esd" => FileType::Arch,
        _ => FileType::Other,
    }
}

/// Estensione minuscola con il punto (es. ".mp4"), oppure stringa vuota se assente.
/// I file che iniziano con il punto (es. ".gitignore") non hanno estensione.
pub fn ext_of(name: &str) -> String {
    match name.rfind('.') {
        Some(i) if i > 0 && i + 1 < name.len() => name[i..].to_lowercase(),
        _ => String::new(),
    }
}

pub(crate) const MONTHS: [&str; 12] = [
    "gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic",
];

/// Data (UTC) in formato "14 nov 2023" a partire dai secondi dall'epoca Unix.
pub fn format_date(secs: i64) -> String {
    // Algoritmo "civil from days" di Howard Hinnant.
    let z = secs.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{day} {} {year}", MONTHS[(month - 1) as usize])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifica_per_estensione() {
        assert_eq!(type_for_ext("mkv"), FileType::Video);
        assert_eq!(type_for_ext("heic"), FileType::Img);
        assert_eq!(type_for_ext("xlsx"), FileType::Doc);
        assert_eq!(type_for_ext("rs"), FileType::Code);
        assert_eq!(type_for_ext("ts"), FileType::Code);
        assert_eq!(type_for_ext("m2ts"), FileType::Video);
        assert_eq!(type_for_ext("iso"), FileType::Arch);
        assert_eq!(type_for_ext("dll"), FileType::Other);
        assert_eq!(type_for_ext(""), FileType::Other);
    }

    #[test]
    fn estrae_l_estensione() {
        assert_eq!(ext_of("Film.MP4"), ".mp4");
        assert_eq!(ext_of("archivio.tar.gz"), ".gz");
        assert_eq!(ext_of("README"), "");
        assert_eq!(ext_of(".gitignore"), "");
        assert_eq!(ext_of("fine."), "");
    }

    #[test]
    fn formatta_le_date() {
        assert_eq!(format_date(0), "1 gen 1970");
        assert_eq!(format_date(1_700_000_000), "14 nov 2023");
        assert_eq!(format_date(951_782_400), "29 feb 2000"); // anno bisestile
        assert_eq!(format_date(-86_400), "31 dic 1969");
    }
}
