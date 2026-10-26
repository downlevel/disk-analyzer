//! Windows-specific functions: disk drives and cluster size.

use std::path::Path;

use windows::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetDiskFreeSpaceW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
};
use windows::core::PCWSTR;

use crate::model::Drive;

const DRIVE_REMOVABLE: u32 = 2;
const DRIVE_FIXED: u32 = 3;
const DRIVE_REMOTE: u32 = 4;

/// Cluster size used when the volume's own cannot be read.
pub const DEFAULT_CLUSTER_SIZE: u64 = 4096;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn from_wide(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

/// Total and free space (bytes) of the volume that contains `path`.
pub fn volume_space(path: &str) -> Option<(u64, u64)> {
    let w = wide(path);
    let (mut free, mut total) = (0u64, 0u64);
    unsafe {
        GetDiskFreeSpaceExW(PCWSTR(w.as_ptr()), Some(&mut free), Some(&mut total), None).ok()?;
    }
    Some((total, free))
}

/// Volume root (e.g. `C:\`) for a path with a drive letter.
pub fn volume_root(path: &Path) -> Option<String> {
    let s = path.to_str()?;
    let mut chars = s.chars();
    let letter = chars.next()?;
    (letter.is_ascii_alphabetic() && chars.next() == Some(':'))
        .then(|| format!("{}:\\", letter.to_ascii_uppercase()))
}

/// Cluster size (bytes) of the volume that contains `path`.
pub fn cluster_size(path: &Path) -> u64 {
    let Some(root) = volume_root(path) else {
        return DEFAULT_CLUSTER_SIZE;
    };
    let w = wide(&root);
    let (mut sectors, mut bytes) = (0u32, 0u32);
    let ok = unsafe {
        GetDiskFreeSpaceW(
            PCWSTR(w.as_ptr()),
            Some(&mut sectors),
            Some(&mut bytes),
            None,
            None,
        )
    };
    match ok {
        Ok(()) if sectors > 0 && bytes > 0 => u64::from(sectors) * u64::from(bytes),
        _ => DEFAULT_CLUSTER_SIZE,
    }
}

fn volume_info(root: &str) -> (String, String) {
    let w = wide(root);
    let mut label = [0u16; 261];
    let mut fs = [0u16; 261];
    let ok = unsafe {
        GetVolumeInformationW(
            PCWSTR(w.as_ptr()),
            Some(&mut label),
            None,
            None,
            None,
            Some(&mut fs),
        )
    };
    if ok.is_err() {
        return (String::new(), String::new());
    }
    (from_wide(&label), from_wide(&fs))
}

/// Disk drives present (fixed, removable and network) with total and used space.
pub fn list_drives() -> Vec<Drive> {
    let mask = unsafe { GetLogicalDrives() };
    let mut drives = Vec::new();
    for i in 0..26u32 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let key = char::from(b'A' + i as u8).to_string();
        let path = format!("{key}:\\");
        let w = wide(&path);
        let kind_name = match unsafe { GetDriveTypeW(PCWSTR(w.as_ptr())) } {
            DRIVE_FIXED => "Local disk",
            DRIVE_REMOVABLE => "Removable",
            DRIVE_REMOTE => "Network",
            _ => continue, // optical drives, RAM disks, unknown type
        };
        // Skip drives that are not ready (e.g. a reader with no media).
        let Some((total, free)) = volume_space(&path) else {
            continue;
        };
        let (label, fs) = volume_info(&path);
        drives.push(Drive {
            letter: format!("{key}:"),
            name: if label.is_empty() {
                kind_name.to_string()
            } else {
                label
            },
            kind: if fs.is_empty() {
                kind_name.to_string()
            } else {
                format!("{kind_name} · {fs}")
            },
            path,
            total,
            used: total.saturating_sub(free),
            key,
        });
    }
    drives
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn volume_root_of_a_path() {
        assert_eq!(
            volume_root(Path::new(r"c:\Users\x")).as_deref(),
            Some(r"C:\")
        );
        assert_eq!(volume_root(Path::new(r"D:\")).as_deref(), Some(r"D:\"));
        assert_eq!(volume_root(Path::new(r"\\server\share")), None);
    }

    #[test]
    fn default_cluster_for_paths_without_a_letter() {
        assert_eq!(
            cluster_size(Path::new(r"\\server\share")),
            DEFAULT_CLUSTER_SIZE
        );
    }

    #[test]
    fn the_system_drive_is_listed() {
        let drives = list_drives();
        assert!(!drives.is_empty());
        for d in &drives {
            assert!(d.total >= d.used);
            assert!(d.path.ends_with(":\\"));
        }
    }

    #[test]
    fn real_cluster_is_a_power_of_two() {
        let root = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
        let c = cluster_size(Path::new(&format!("{root}\\")));
        assert!(c.is_power_of_two() && c >= 512, "cluster = {c}");
    }
}
