//! Installed desktop apps: list from the Windows registry and measurement of their folders.
//!
//! Apps are read from the registry `Uninstall` keys (the same ones behind Windows' "Installed
//! apps"). Only classic desktop apps are included; Microsoft Store apps are not.
//! The size declared in the registry (`EstimatedSize`) is often missing or approximate:
//! where the install folder is known it is actually measured with the scanner.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use tracing::{debug, warn};
use winreg::RegKey;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};

use crate::filetype::MONTHS;
use crate::model::{AppScope, AppSize, InstalledApp, SizeStatus};
use crate::scanner::{self, Outcome, ScanError, ScanOptions};
use crate::sys;

const UNINSTALL: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
const UNINSTALL_32: &str = r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";

/// Values of an `Uninstall` entry. A trait, so the filtering logic can be tested without the registry.
pub trait ValueSource {
    fn string(&self, name: &str) -> Option<String>;
    fn dword(&self, name: &str) -> Option<u32>;
}

impl ValueSource for RegKey {
    fn string(&self, name: &str) -> Option<String> {
        self.get_value::<String, _>(name).ok()
    }
    fn dword(&self, name: &str) -> Option<u32> {
        self.get_value::<u32, _>(name).ok()
    }
}

/// Folders where it makes no sense (or is dangerous) to measure "an app's folder": system and
/// user roots, which contain far more than the single app.
#[derive(Debug, Clone, Default)]
pub struct Roots {
    /// Folders excluded as such (not their contents): e.g. `C:\Program Files`.
    pub exact: Vec<PathBuf>,
    /// Folders excluded together with everything they contain: e.g. `C:\Windows`.
    pub tree: Vec<PathBuf>,
    /// Roots under which a folder derived from the icon or the uninstaller is accepted.
    pub install_roots: Vec<PathBuf>,
}

fn env_path(var: &str) -> Option<PathBuf> {
    std::env::var_os(var)
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
}

impl Roots {
    pub fn from_env() -> Roots {
        let mut roots = Roots::default();
        let program_files = ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"];
        for var in program_files {
            if let Some(p) = env_path(var) {
                roots.exact.push(p.clone());
                roots.install_roots.push(p);
            }
        }
        for var in [
            "ProgramData",
            "USERPROFILE",
            "LOCALAPPDATA",
            "APPDATA",
            "PUBLIC",
        ] {
            if let Some(p) = env_path(var) {
                roots.exact.push(p);
            }
        }
        if let Some(local) = env_path("LOCALAPPDATA") {
            roots.install_roots.push(local.join("Programs"));
            roots.install_roots.push(local);
        }
        if let Some(root) = env_path("SystemRoot") {
            roots.tree.push(root);
        }
        if let Some(drive) = env_path("SystemDrive") {
            roots
                .exact
                .push(PathBuf::from(format!("{}\\", drive.display())));
            roots.exact.push(drive.join("Users"));
        }
        roots
    }
}

fn norm(p: &str) -> String {
    p.trim()
        .trim_matches('"')
        .trim_end_matches(['\\', '/'])
        .replace('/', "\\")
        .to_lowercase()
}

fn is_drive_root(p: &str) -> bool {
    let n = norm(p);
    n.len() <= 2 && n.ends_with(':')
}

fn starts_within(path: &str, base: &Path) -> bool {
    let (path, base) = (norm(path), norm(&base.to_string_lossy()));
    path.len() > base.len() && path.starts_with(&base) && path[base.len()..].starts_with('\\')
}

/// Usable install folder: non-empty, not a system or user root.
fn usable_location(path: &str, roots: &Roots) -> Option<String> {
    let cleaned = path.trim().trim_matches('"').trim();
    let cleaned = if cleaned.len() > 3 {
        cleaned.trim_end_matches(['\\', '/'])
    } else {
        cleaned
    };
    if cleaned.is_empty() || is_drive_root(cleaned) {
        return None;
    }
    // Must be an absolute path with a drive letter.
    let b = cleaned.as_bytes();
    if b.len() < 3 || !b[0].is_ascii_alphabetic() || b[1] != b':' {
        return None;
    }
    let n = norm(cleaned);
    if roots.exact.iter().any(|r| norm(&r.to_string_lossy()) == n) {
        return None;
    }
    if roots
        .tree
        .iter()
        .any(|r| norm(&r.to_string_lossy()) == n || starts_within(cleaned, r))
    {
        return None;
    }
    Some(cleaned.to_string())
}

/// First executable file named in a value such as `"C:\x\app.exe",0` o `"C:\x\unins.exe" /S`.
fn exe_path(value: &str) -> Option<String> {
    let v = value.trim();
    let path = if let Some(rest) = v.strip_prefix('"') {
        rest.split('"').next()?.to_string()
    } else {
        // Without quotes: up to the end of the .exe/.ico/.dll extension, without arguments.
        let lower = v.to_lowercase();
        let end = [".exe", ".ico", ".dll"]
            .iter()
            .filter_map(|ext| lower.find(ext).map(|i| i + ext.len()))
            .min()?;
        v[..end].to_string()
    };
    // Strips the icon index (",0").
    let path = path
        .rsplit_once(',')
        .filter(|(_, n)| n.trim().parse::<i32>().is_ok())
        .map_or(path.clone(), |(p, _)| p.to_string());
    (!path.is_empty()).then_some(path)
}

/// App folder derived from the icon or the uninstaller, only if it lies under a known install
/// root (e.g. `Program Files`) and is not the root itself.
pub fn derive_location(
    display_icon: Option<&str>,
    uninstall: Option<&str>,
    roots: &Roots,
) -> Option<String> {
    [display_icon, uninstall]
        .into_iter()
        .flatten()
        .find_map(|value| {
            let exe = exe_path(value)?;
            let dir = Path::new(&exe).parent()?.to_string_lossy().into_owned();
            let dir = usable_location(&dir, roots)?;
            roots
                .install_roots
                .iter()
                .any(|r| starts_within(&dir, r))
                .then_some(dir)
        })
}

/// "20251010" → "10 Oct 2025".
pub fn format_install_date(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.len() != 8 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (year, month, day): (u32, usize, u32) = (
        s[..4].parse().ok()?,
        s[4..6].parse().ok()?,
        s[6..].parse().ok()?,
    );
    ((1..=12).contains(&month) && (1..=31).contains(&day) && year >= 1980)
        .then(|| format!("{day} {} {year}", MONTHS[month - 1]))
}

fn clean(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

const UPDATE_TYPES: [&str; 6] = [
    "update",
    "hotfix",
    "security update",
    "service pack",
    "critical update",
    "update rollup",
];

/// Converts a registry entry into an app, discarding system components and updates.
pub fn parse_app(
    scope: AppScope,
    key: &str,
    src: &impl ValueSource,
    roots: &Roots,
) -> Option<InstalledApp> {
    let name = clean(src.string("DisplayName"))?;
    if src.dword("SystemComponent") == Some(1) || clean(src.string("ParentKeyName")).is_some() {
        return None;
    }
    if let Some(release) = clean(src.string("ReleaseType"))
        && UPDATE_TYPES.contains(&release.to_lowercase().as_str())
    {
        return None;
    }

    let declared = clean(src.string("InstallLocation")).and_then(|p| usable_location(&p, roots));
    let derived = if declared.is_none() {
        derive_location(
            src.string("DisplayIcon").as_deref(),
            src.string("UninstallString").as_deref(),
            roots,
        )
    } else {
        None
    };
    let location_derived = derived.is_some();

    let scope_prefix = match scope {
        AppScope::Machine => "machine",
        AppScope::Machine32 => "machine32",
        AppScope::User => "user",
    };
    Some(InstalledApp {
        id: format!("{scope_prefix}:{key}"),
        name,
        version: clean(src.string("DisplayVersion")),
        publisher: clean(src.string("Publisher")),
        install_location: declared.or(derived),
        location_derived,
        shared_location: false,
        estimated_size: src
            .dword("EstimatedSize")
            .filter(|&kb| kb > 0)
            .map(|kb| u64::from(kb) * 1024),
        install_date: src
            .string("InstallDate")
            .and_then(|d| format_install_date(&d)),
        scope,
    })
}

/// Removes duplicates (the same app registered in several views), marks shared folders and
/// sorts by name.
pub fn finish(apps: Vec<InstalledApp>) -> Vec<InstalledApp> {
    let mut unique: Vec<InstalledApp> = Vec::new();
    let mut seen: HashMap<(String, String), usize> = HashMap::new();
    for app in apps {
        let key = (
            app.name.to_lowercase(),
            app.version.clone().unwrap_or_default().to_lowercase(),
        );
        match seen.get(&key) {
            Some(&i) => {
                // Keeps the entry with the most information.
                let score = |a: &InstalledApp| {
                    u8::from(a.install_location.is_some()) + u8::from(a.estimated_size.is_some())
                };
                if score(&app) > score(&unique[i]) {
                    unique[i] = app;
                }
            }
            None => {
                seen.insert(key, unique.len());
                unique.push(app);
            }
        }
    }

    let mut per_location: HashMap<String, usize> = HashMap::new();
    for app in &unique {
        if let Some(loc) = &app.install_location {
            *per_location.entry(norm(loc)).or_default() += 1;
        }
    }
    for app in &mut unique {
        app.shared_location = app
            .install_location
            .as_ref()
            .is_some_and(|loc| per_location.get(&norm(loc)).copied().unwrap_or(0) > 1);
    }
    unique.sort_by_key(|a| a.name.to_lowercase());
    unique
}

/// List of installed desktop apps, read from the registry.
pub fn list() -> Vec<InstalledApp> {
    let roots = Roots::from_env();
    let sources = [
        (AppScope::Machine, HKEY_LOCAL_MACHINE, UNINSTALL),
        (AppScope::Machine32, HKEY_LOCAL_MACHINE, UNINSTALL_32),
        (AppScope::User, HKEY_CURRENT_USER, UNINSTALL),
    ];
    let mut apps = Vec::new();
    for (scope, hive, path) in sources {
        let Ok(root) = RegKey::predef(hive).open_subkey_with_flags(path, KEY_READ) else {
            debug!(path, "Uninstall key not readable");
            continue;
        };
        for key in root.enum_keys().flatten() {
            match root.open_subkey_with_flags(&key, KEY_READ) {
                Ok(sub) => apps.extend(parse_app(scope, &key, &sub, &roots)),
                Err(e) => debug!(key, error = %e, "entry not readable"),
            }
        }
    }
    finish(apps)
}

/// Measures an app's folder (logical size, size on disk and file count).
/// `None` if the measurement was cancelled.
pub fn measure(id: &str, path: &str, cancel: &AtomicBool) -> Option<AppSize> {
    let root = Path::new(path);
    let opts = ScanOptions {
        cluster_size: sys::cluster_size(root),
        // Only the totals are needed here: no individually kept files, minimal tree.
        keep_files_per_dir: 0,
        ..ScanOptions::default()
    };
    let result = |status, size, disk, files| AppSize {
        id: id.to_string(),
        status,
        path: path.to_string(),
        size,
        disk,
        files,
    };

    match scanner::scan(root, &opts, cancel, |_| {}) {
        Ok(Outcome::Completed { tree, .. }) => {
            let r = tree.get(tree.root_id()).expect("the root always exists");
            Some(result(SizeStatus::Measured, r.size, r.disk, r.files))
        }
        Ok(Outcome::Cancelled(_)) => None,
        Err(ScanError::NotFound | ScanError::NotADirectory) => {
            Some(result(SizeStatus::Missing, 0, 0, 0))
        }
        Err(ScanError::Denied) => Some(result(SizeStatus::Denied, 0, 0, 0)),
        Err(ScanError::Io(e)) => {
            warn!(id, path, error = %e, "folder measurement failed");
            Some(result(SizeStatus::Failed, 0, 0, 0))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::atomic::AtomicBool;

    #[derive(Default)]
    struct Fake {
        strings: HashMap<&'static str, &'static str>,
        dwords: HashMap<&'static str, u32>,
    }
    impl Fake {
        fn s(mut self, k: &'static str, v: &'static str) -> Self {
            self.strings.insert(k, v);
            self
        }
        fn d(mut self, k: &'static str, v: u32) -> Self {
            self.dwords.insert(k, v);
            self
        }
    }
    impl ValueSource for Fake {
        fn string(&self, name: &str) -> Option<String> {
            self.strings.get(name).map(|v| v.to_string())
        }
        fn dword(&self, name: &str) -> Option<u32> {
            self.dwords.get(name).copied()
        }
    }

    fn roots() -> Roots {
        Roots {
            exact: vec![
                r"C:\Program Files".into(),
                r"C:\Program Files (x86)".into(),
                r"C:\ProgramData".into(),
                r"C:\Users\user".into(),
                r"C:\Users\user\AppData\Local".into(),
                r"C:\".into(),
            ],
            tree: vec![r"C:\Windows".into()],
            install_roots: vec![
                r"C:\Program Files".into(),
                r"C:\Program Files (x86)".into(),
                r"C:\Users\user\AppData\Local\Programs".into(),
                r"C:\Users\user\AppData\Local".into(),
            ],
        }
    }

    fn parse(f: &Fake) -> Option<InstalledApp> {
        parse_app(AppScope::Machine, "App1", f, &roots())
    }

    #[test]
    fn reads_the_fields_of_an_app() {
        let app = parse(
            &Fake::default()
                .s("DisplayName", "  7-Zip 25.01 (x64) ")
                .s("DisplayVersion", "25.01")
                .s("Publisher", "Igor Pavlov")
                .s("InstallLocation", r"C:\Program Files\7-Zip\")
                .s("InstallDate", "20251010")
                .d("EstimatedSize", 5758),
        )
        .unwrap();
        assert_eq!(app.id, "machine:App1");
        assert_eq!(app.name, "7-Zip 25.01 (x64)");
        assert_eq!(app.version.as_deref(), Some("25.01"));
        assert_eq!(app.publisher.as_deref(), Some("Igor Pavlov"));
        assert_eq!(
            app.install_location.as_deref(),
            Some(r"C:\Program Files\7-Zip")
        );
        assert!(!app.location_derived);
        assert_eq!(app.estimated_size, Some(5758 * 1024));
        assert_eq!(app.install_date.as_deref(), Some("10 Oct 2025"));
    }

    #[test]
    fn discards_system_components_updates_and_unnamed_entries() {
        assert!(parse(&Fake::default()).is_none());
        assert!(parse(&Fake::default().s("DisplayName", "   ")).is_none());
        assert!(
            parse(
                &Fake::default()
                    .s("DisplayName", "X")
                    .d("SystemComponent", 1)
            )
            .is_none()
        );
        assert!(
            parse(
                &Fake::default()
                    .s("DisplayName", "X")
                    .s("ParentKeyName", "Office")
            )
            .is_none()
        );
        assert!(
            parse(
                &Fake::default()
                    .s("DisplayName", "KB1")
                    .s("ReleaseType", "Security Update")
            )
            .is_none()
        );
        // A ReleaseType value other than an update does not exclude the app.
        assert!(
            parse(
                &Fake::default()
                    .s("DisplayName", "X")
                    .s("ReleaseType", "Application")
            )
            .is_some()
        );
        assert!(
            parse(
                &Fake::default()
                    .s("DisplayName", "X")
                    .d("SystemComponent", 0)
            )
            .is_some()
        );
    }

    #[test]
    fn missing_or_zero_estimated_size_is_ignored() {
        assert_eq!(
            parse(&Fake::default().s("DisplayName", "X"))
                .unwrap()
                .estimated_size,
            None
        );
        assert_eq!(
            parse(&Fake::default().s("DisplayName", "X").d("EstimatedSize", 0))
                .unwrap()
                .estimated_size,
            None
        );
    }

    #[test]
    fn rejects_overly_broad_folders() {
        for loc in [
            r"C:\",
            r"C:",
            r"C:\Program Files",
            r"C:\Program Files\",
            r"C:\Windows",
            r"C:\Windows\Installer\{ABC}",
            r"C:\Users\user",
            r"C:\Users\user\AppData\Local",
            "",
            "Program Files\\X",
        ] {
            let app = parse(
                &Fake::default()
                    .s("DisplayName", "X")
                    .s("InstallLocation", loc),
            )
            .unwrap();
            assert_eq!(
                app.install_location, None,
                "{loc:?} should have been rejected"
            );
        }
        let ok = parse(
            &Fake::default()
                .s("DisplayName", "X")
                .s("InstallLocation", r#""C:\Python313\""#),
        )
        .unwrap();
        assert_eq!(ok.install_location.as_deref(), Some(r"C:\Python313"));
    }

    #[test]
    fn derives_the_folder_from_the_icon_or_the_uninstaller() {
        let r = roots();
        assert_eq!(
            derive_location(
                Some(r#""C:\Program Files\Notepad++\notepad++.exe",0"#),
                None,
                &r
            )
            .as_deref(),
            Some(r"C:\Program Files\Notepad++")
        );
        assert_eq!(
            derive_location(Some(r"C:\Program Files (x86)\App\app.exe,1"), None, &r).as_deref(),
            Some(r"C:\Program Files (x86)\App")
        );
        assert_eq!(
            derive_location(
                None,
                Some(r#""C:\Users\user\AppData\Local\Programs\Tool\unins000.exe" /SILENT"#),
                &r
            )
            .as_deref(),
            Some(r"C:\Users\user\AppData\Local\Programs\Tool")
        );
        // An unusable icon leaves room for the uninstaller.
        assert_eq!(
            derive_location(
                Some(r"C:\Windows\Installer\{X}\icon.ico"),
                Some(r#""C:\Program Files\Y\unins.exe""#),
                &r
            )
            .as_deref(),
            Some(r"C:\Program Files\Y")
        );
    }

    #[test]
    fn does_not_derive_unreliable_folders() {
        let r = roots();
        assert_eq!(
            derive_location(Some(r"C:\Windows\Installer\{X}\icon.ico"), None, &r),
            None
        );
        assert_eq!(
            derive_location(None, Some("MsiExec.exe /X{GUID}"), &r),
            None
        );
        assert_eq!(
            derive_location(Some(r"C:\Program Files\app.exe"), None, &r),
            None
        ); // the root itself
        assert_eq!(derive_location(Some(r"D:\Games\g.exe"), None, &r), None); // outside the known roots
        assert_eq!(derive_location(None, None, &r), None);
    }

    #[test]
    fn the_derived_folder_is_flagged() {
        let app = parse(
            &Fake::default()
                .s("DisplayName", "Notepad++")
                .s("DisplayIcon", r"C:\Program Files\Notepad++\notepad++.exe"),
        )
        .unwrap();
        assert_eq!(
            app.install_location.as_deref(),
            Some(r"C:\Program Files\Notepad++")
        );
        assert!(app.location_derived);
    }

    #[test]
    fn formats_the_install_date() {
        assert_eq!(
            format_install_date("20251010").as_deref(),
            Some("10 Oct 2025")
        );
        assert_eq!(
            format_install_date("20240229").as_deref(),
            Some("29 Feb 2024")
        );
        for bad in [
            "",
            "2025",
            "20251310",
            "20250001",
            "abcdefgh",
            "19700101",
            "2025-10-10",
        ] {
            assert_eq!(format_install_date(bad), None, "{bad:?}");
        }
    }

    fn app(
        id: &str,
        name: &str,
        version: &str,
        loc: Option<&str>,
        kb: Option<u64>,
    ) -> InstalledApp {
        InstalledApp {
            id: id.into(),
            name: name.into(),
            version: Some(version.into()),
            publisher: None,
            install_location: loc.map(Into::into),
            location_derived: false,
            shared_location: false,
            estimated_size: kb.map(|k| k * 1024),
            install_date: None,
            scope: AppScope::Machine,
        }
    }

    #[test]
    fn removes_duplicates_keeping_the_richest_entry() {
        let out = finish(vec![
            app("machine:a", "Tool", "1.0", None, None),
            app(
                "machine32:a",
                "TOOL",
                "1.0",
                Some(r"C:\Program Files\Tool"),
                Some(10),
            ),
            app("user:b", "Tool", "2.0", None, None),
        ]);
        assert_eq!(out.len(), 2);
        let v1 = out
            .iter()
            .find(|a| a.version.as_deref() == Some("1.0"))
            .unwrap();
        assert_eq!(v1.id, "machine32:a");
    }

    #[test]
    fn marks_shared_folders_and_sorts_by_name() {
        let out = finish(vec![
            app("a", "Word", "1", Some(r"C:\Program Files\Office"), None),
            app("b", "Excel", "1", Some(r"c:\program files\office\"), None),
            app("c", "Alpha", "1", Some(r"C:\Program Files\Alfa"), None),
            app("d", "Beta", "1", None, None),
        ]);
        let names: Vec<_> = out.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, ["Alpha", "Beta", "Excel", "Word"]);
        let shared: Vec<_> = out
            .iter()
            .filter(|a| a.shared_location)
            .map(|a| a.name.as_str())
            .collect();
        assert_eq!(shared, ["Excel", "Word"]);
    }

    #[test]
    fn the_real_registry_list_is_consistent() {
        let apps = list();
        assert!(
            !apps.is_empty(),
            "a Windows PC has at least one installed app"
        );
        let mut ids: Vec<_> = apps.iter().map(|a| a.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), apps.len(), "ids must be unique");
        assert!(apps.iter().all(|a| !a.name.trim().is_empty()));
        // No install folder may be a system root.
        let r = Roots::from_env();
        for a in &apps {
            if let Some(loc) = &a.install_location {
                assert!(usable_location(loc, &r).is_some(), "{} → {loc}", a.name);
            }
        }
    }

    #[test]
    fn measures_a_folder() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("a.bin"), [0u8; 100]).unwrap();
        std::fs::write(dir.path().join("sub").join("b.bin"), [0u8; 50]).unwrap();
        let size = measure("x", &dir.path().to_string_lossy(), &AtomicBool::new(false)).unwrap();
        assert_eq!(size.status, SizeStatus::Measured);
        assert_eq!((size.size, size.files), (150, 2));
        assert!(size.disk >= 150);
    }

    #[test]
    fn measuring_a_missing_or_cancelled_folder() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("does-not-exist");
        let size = measure("x", &missing.to_string_lossy(), &AtomicBool::new(false)).unwrap();
        assert_eq!(size.status, SizeStatus::Missing);
        assert_eq!(size.size, 0);

        assert!(measure("x", &dir.path().to_string_lossy(), &AtomicBool::new(true)).is_none());
    }
}
