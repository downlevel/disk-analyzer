//! File classification by extension and date formatting.

use crate::model::FileType;

/// File type from the extension (lowercase, without the dot).
pub fn type_for_ext(ext: &str) -> FileType {
    match ext {
        // ".ts" is also a video format (MPEG transport stream), but on development PCs
        // it is almost always TypeScript: we classify it as code.
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

/// Lowercase extension with the dot (e.g. ".mp4"), or an empty string if absent.
/// Files that start with a dot (e.g. ".gitignore") have no extension.
pub fn ext_of(name: &str) -> String {
    match name.rfind('.') {
        Some(i) if i > 0 && i + 1 < name.len() => name[i..].to_lowercase(),
        _ => String::new(),
    }
}

pub(crate) const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// Date (UTC) formatted as "14 Nov 2023" from seconds since the Unix epoch.
pub fn format_date(secs: i64) -> String {
    // Howard Hinnant's "civil from days" algorithm.
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
    fn classifies_by_extension() {
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
    fn extracts_the_extension() {
        assert_eq!(ext_of("Movie.MP4"), ".mp4");
        assert_eq!(ext_of("archive.tar.gz"), ".gz");
        assert_eq!(ext_of("README"), "");
        assert_eq!(ext_of(".gitignore"), "");
        assert_eq!(ext_of("end."), "");
    }

    #[test]
    fn formats_dates() {
        assert_eq!(format_date(0), "1 Jan 1970");
        assert_eq!(format_date(1_700_000_000), "14 Nov 2023");
        assert_eq!(format_date(951_782_400), "29 Feb 2000"); // leap year
        assert_eq!(format_date(-86_400), "31 Dec 1969");
    }
}
