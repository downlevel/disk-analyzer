//! Tree of a scan's results.
//!
//! The scanner produces a tree of [`DirNode`]; [`ScanTree::build`] flattens it into a compact
//! arena (`Vec<Entry>`) in which the children of each node are contiguous. To keep memory
//! under control on large disks, only the largest files of each folder are kept individually:
//! the others are merged into a single aggregate node "Files (N)".

use std::cmp::Reverse;
use std::collections::{BinaryHeap, VecDeque};

use crate::filetype::{ext_of, format_date};
use crate::model::{ExtStat, FileType, Node, NodeKind, TypeBreakdown, TypeStat, TypeStats};

pub(crate) const NO_PARENT: u32 = u32::MAX;
const TYPES: usize = FileType::ALL.len();

/// File kept individually.
pub(crate) struct FileNode {
    pub name: String,
    pub size: u64,
    pub disk: u64,
    pub ftype: FileType,
    /// Seconds since the Unix epoch (0 if unknown).
    pub modified: i64,
}

/// Files of a folder merged into a single node.
#[derive(Default)]
pub(crate) struct Agg {
    pub size: u64,
    pub disk: u64,
    pub files: u64,
    pub by_type: [u64; TYPES],
}

/// Freshly scanned folder, before being flattened into the arena.
pub(crate) struct DirNode {
    pub name: String,
    pub denied: bool,
    pub files: Vec<FileNode>,
    pub agg: Option<Agg>,
    pub dirs: Vec<DirNode>,
    pub size: u64,
    pub disk: u64,
    pub total_files: u64,
    pub total_dirs: u64,
    pub by_type: [u64; TYPES],
}

impl DirNode {
    pub fn new(name: String) -> Self {
        DirNode {
            name,
            denied: false,
            files: Vec::new(),
            agg: None,
            dirs: Vec::new(),
            size: 0,
            disk: 0,
            total_files: 0,
            total_dirs: 0,
            by_type: [0; TYPES],
        }
    }
}

/// Total per extension, over all scanned files (including aggregated ones).
#[derive(Debug, Clone)]
pub struct ExtTotal {
    /// Extension with the dot, or "(none)".
    pub ext: String,
    pub ftype: FileType,
    pub size: u64,
    pub files: u64,
}

struct Entry {
    name: Box<str>,
    parent: u32,
    kind: NodeKind,
    size: u64,
    disk: u64,
    files: u64,
    dirs: u64,
    by_type: [u64; TYPES],
    ftype: FileType,
    modified: i64,
    first_child: u32,
    child_count: u32,
}

fn dominant_type(by_type: &[u64; TYPES]) -> FileType {
    let mut best = FileType::Other;
    let mut max = 0;
    for t in FileType::ALL {
        if by_type[t.index()] > max {
            max = by_type[t.index()];
            best = t;
        }
    }
    best
}

impl Entry {
    fn from_dir(dir: &DirNode, parent: u32) -> Self {
        Entry {
            name: dir.name.clone().into_boxed_str(),
            parent,
            kind: if dir.denied {
                NodeKind::Denied
            } else {
                NodeKind::Dir
            },
            size: dir.size,
            disk: dir.disk,
            files: dir.total_files,
            dirs: dir.total_dirs,
            by_type: dir.by_type,
            ftype: dominant_type(&dir.by_type),
            modified: 0,
            first_child: 0,
            child_count: 0,
        }
    }

    fn from_file(file: FileNode, parent: u32) -> Self {
        let mut by_type = [0; TYPES];
        by_type[file.ftype.index()] = file.size;
        Entry {
            name: file.name.into_boxed_str(),
            parent,
            kind: NodeKind::File,
            size: file.size,
            disk: file.disk,
            files: 1,
            dirs: 0,
            by_type,
            ftype: file.ftype,
            modified: file.modified,
            first_child: 0,
            child_count: 0,
        }
    }

    fn from_agg(agg: &Agg, parent: u32) -> Self {
        Entry {
            name: "".into(),
            parent,
            kind: NodeKind::Agg,
            size: agg.size,
            disk: agg.disk,
            files: agg.files,
            dirs: 0,
            by_type: agg.by_type,
            ftype: dominant_type(&agg.by_type),
            modified: 0,
            first_child: 0,
            child_count: 0,
        }
    }
}

pub struct ScanTree {
    entries: Vec<Entry>,
    root_path: String,
    exts: Vec<ExtTotal>,
    denied: Vec<u32>,
}

impl ScanTree {
    /// Flattens the tree breadth-first, so the children of each node are contiguous.
    pub(crate) fn build(root_path: String, mut root: DirNode, exts: Vec<ExtTotal>) -> ScanTree {
        root.name = root_path.clone();
        let mut entries = vec![Entry::from_dir(&root, NO_PARENT)];
        let mut denied = Vec::new();
        let mut queue = VecDeque::from([(0u32, root)]);

        while let Some((id, dir)) = queue.pop_front() {
            let first = entries.len() as u32;
            let DirNode {
                files, agg, dirs, ..
            } = dir;

            for sub in dirs {
                let child_id = entries.len() as u32;
                entries.push(Entry::from_dir(&sub, id));
                if sub.denied {
                    denied.push(child_id);
                }
                queue.push_back((child_id, sub));
            }
            for file in files {
                entries.push(Entry::from_file(file, id));
            }
            if let Some(agg) = agg {
                entries.push(Entry::from_agg(&agg, id));
            }

            let count = entries.len() as u32 - first;
            let entry = &mut entries[id as usize];
            entry.first_child = first;
            entry.child_count = count;
        }

        ScanTree {
            entries,
            root_path,
            exts,
            denied,
        }
    }

    pub fn root_id(&self) -> u64 {
        0
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    fn entry(&self, id: u64) -> Option<&Entry> {
        self.entries.get(usize::try_from(id).ok()?)
    }

    /// Full path; for aggregate nodes, that of the folder that contains them.
    fn path_of(&self, id: u32) -> String {
        let mut id = id;
        if self.entries[id as usize].kind == NodeKind::Agg {
            id = self.entries[id as usize].parent;
        }
        let mut names = Vec::new();
        while id != 0 {
            names.push(&*self.entries[id as usize].name);
            id = self.entries[id as usize].parent;
        }
        let mut path = self.root_path.clone();
        for name in names.into_iter().rev() {
            if !path.ends_with('\\') {
                path.push('\\');
            }
            path.push_str(name);
        }
        path
    }

    fn node(&self, id: u32) -> Node {
        let e = &self.entries[id as usize];
        let is_file = e.kind == NodeKind::File;
        let is_leaf_type = matches!(e.kind, NodeKind::File | NodeKind::Agg);
        Node {
            id: u64::from(id),
            parent_id: (e.parent != NO_PARENT).then_some(u64::from(e.parent)),
            name: e.name.to_string(),
            path: self.path_of(id),
            kind: e.kind,
            size: e.size,
            disk: e.disk,
            files: e.files,
            dirs: e.dirs,
            file_type: is_leaf_type.then_some(e.ftype),
            ext: is_file.then(|| ext_of(&e.name)),
            modified: (is_file && e.modified != 0).then(|| format_date(e.modified)),
            child_count: e.child_count,
            by_type: TypeBreakdown::from(e.by_type),
        }
    }

    pub fn get(&self, id: u64) -> Option<Node> {
        self.entry(id)?;
        Some(self.node(id as u32))
    }

    /// Children of a node, largest first, at most `cap`; the aggregate node, if any, is always kept.
    pub fn children(&self, id: u64, cap: usize) -> Vec<Node> {
        let Some(e) = self.entry(id) else {
            return Vec::new();
        };
        let range = e.first_child..e.first_child + e.child_count;
        let mut ids: Vec<u32> = range
            .clone()
            .filter(|&c| self.entries[c as usize].kind != NodeKind::Agg)
            .collect();
        ids.sort_by_key(|&c| (Reverse(self.entries[c as usize].size), c));
        ids.truncate(cap);
        if let Some(last) = range
            .last()
            .filter(|&c| self.entries[c as usize].kind == NodeKind::Agg)
        {
            ids.push(last);
        }
        ids.into_iter().map(|c| self.node(c)).collect()
    }

    /// Chain of ancestors from the root to the node (included).
    pub fn ancestors(&self, id: u64) -> Vec<u64> {
        let mut chain = Vec::new();
        let mut cur = self.entry(id).map(|_| id as u32);
        while let Some(c) = cur {
            chain.push(u64::from(c));
            let parent = self.entries[c as usize].parent;
            cur = (parent != NO_PARENT).then_some(parent);
        }
        chain.reverse();
        chain
    }

    /// The largest files, optionally of a single type.
    pub fn top_files(&self, filter: Option<FileType>, limit: usize) -> Vec<Node> {
        let mut heap: BinaryHeap<Reverse<(u64, u32)>> = BinaryHeap::with_capacity(limit + 1);
        for (i, e) in self.entries.iter().enumerate() {
            if e.kind != NodeKind::File || filter.is_some_and(|t| e.ftype != t) {
                continue;
            }
            heap.push(Reverse((e.size, i as u32)));
            if heap.len() > limit {
                heap.pop();
            }
        }
        let mut top: Vec<(u64, u32)> = heap.into_iter().map(|Reverse(x)| x).collect();
        top.sort_by(|a, b| b.cmp(a));
        top.into_iter().map(|(_, id)| self.node(id)).collect()
    }

    pub fn type_stats(&self, ext_limit: usize) -> TypeStats {
        let root = &self.entries[0];
        let mut files = [0u64; TYPES];
        for x in &self.exts {
            files[x.ftype.index()] += x.files;
        }
        TypeStats {
            types: FileType::ALL
                .iter()
                .map(|&t| TypeStat {
                    file_type: t,
                    size: root.by_type[t.index()],
                    files: files[t.index()],
                })
                .collect(),
            exts: self
                .exts
                .iter()
                .take(ext_limit)
                .map(|x| ExtStat {
                    ext: x.ext.clone(),
                    file_type: x.ftype,
                    size: x.size,
                    files: x.files,
                })
                .collect(),
            total_size: root.size,
            total_files: root.files,
        }
    }

    pub fn denied(&self, limit: usize) -> Vec<Node> {
        self.denied
            .iter()
            .take(limit)
            .map(|&id| self.node(id))
            .collect()
    }
}
