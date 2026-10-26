use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use crate::model::InstalledApp;
use crate::tree::ScanTree;

#[derive(Default)]
struct Inner {
    /// Running scans, each with its own cancellation flag.
    active: HashMap<u64, Arc<AtomicBool>>,
    /// Result of the last completed scan (only one is kept).
    result: Option<(u64, Arc<ScanTree>)>,
}

/// Shared state of the scans.
///
/// Identifiers are assigned by the frontend, so it can listen to a scan's events
/// before even starting it, without missing any.
#[derive(Default)]
pub struct ScanRegistry {
    inner: Mutex<Inner>,
}

impl ScanRegistry {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Registers a new scan: cancels any still running (only one is active) and
    /// frees the previous result.
    pub fn begin(&self, id: u64) -> Arc<AtomicBool> {
        let mut inner = self.lock();
        for flag in inner.active.values() {
            flag.store(true, Ordering::Relaxed);
        }
        inner.result = None;
        let flag = Arc::new(AtomicBool::new(false));
        inner.active.insert(id, flag.clone());
        flag
    }

    /// Requests cancellation of a scan. Returns `false` if it is not running.
    pub fn cancel(&self, id: u64) -> bool {
        match self.lock().active.get(&id) {
            Some(flag) => {
                flag.store(true, Ordering::Relaxed);
                true
            }
            None => false,
        }
    }

    pub fn finish(&self, id: u64) {
        self.lock().active.remove(&id);
    }

    /// Keeps the result of a scan, unless another one has started in the meantime.
    pub fn store_result(&self, id: u64, tree: Arc<ScanTree>) {
        let mut inner = self.lock();
        let superseded = inner
            .active
            .get(&id)
            .is_some_and(|f| f.load(Ordering::Relaxed));
        if !superseded {
            inner.result = Some((id, tree));
        }
    }

    pub fn result(&self, id: u64) -> Option<Arc<ScanTree>> {
        self.lock()
            .result
            .as_ref()
            .filter(|(rid, _)| *rid == id)
            .map(|(_, t)| t.clone())
    }
}

/// List of installed apps and measurement of their sizes (one at a time).
#[derive(Default)]
pub struct AppsState {
    apps: Mutex<Vec<InstalledApp>>,
    cancel: Mutex<Option<Arc<AtomicBool>>>,
}

impl AppsState {
    pub fn set_apps(&self, apps: Vec<InstalledApp>) {
        *self.apps.lock().unwrap_or_else(|e| e.into_inner()) = apps;
    }

    pub fn apps(&self) -> Vec<InstalledApp> {
        self.apps.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Starts a new measurement, cancelling any one in progress.
    pub fn begin_measure(&self) -> Arc<AtomicBool> {
        let mut cancel = self.cancel.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(previous) = cancel.as_ref() {
            previous.store(true, Ordering::Relaxed);
        }
        let flag = Arc::new(AtomicBool::new(false));
        *cancel = Some(flag.clone());
        flag
    }

    /// Requests cancellation of the current measurement. `false` if there is none.
    pub fn cancel_measure(&self) -> bool {
        match self
            .cancel
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            Some(flag) => {
                flag.store(true, Ordering::Relaxed);
                true
            }
            None => false,
        }
    }

    /// Marks the measurement identified by `flag` as finished (if it is still the current one).
    pub fn finish_measure(&self, flag: &Arc<AtomicBool>) {
        let mut cancel = self.cancel.lock().unwrap_or_else(|e| e.into_inner());
        if cancel.as_ref().is_some_and(|c| Arc::ptr_eq(c, flag)) {
            *cancel = None;
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_sets_the_flag() {
        let registry = ScanRegistry::default();
        let flag = registry.begin(1);
        assert!(!flag.load(Ordering::Relaxed));
        assert!(registry.cancel(1));
        assert!(flag.load(Ordering::Relaxed));
    }

    #[test]
    fn cancel_of_an_unknown_scan() {
        let registry = ScanRegistry::default();
        assert!(!registry.cancel(42));
    }

    #[test]
    fn a_new_scan_cancels_the_previous_one() {
        let registry = ScanRegistry::default();
        let first = registry.begin(1);
        let second = registry.begin(2);
        assert!(first.load(Ordering::Relaxed));
        assert!(!second.load(Ordering::Relaxed));
    }

    #[test]
    fn finish_removes_the_scan() {
        let registry = ScanRegistry::default();
        registry.begin(1);
        registry.finish(1);
        assert!(!registry.cancel(1));
    }

    fn empty_tree() -> Arc<ScanTree> {
        use crate::tree::DirNode;
        Arc::new(ScanTree::build(
            r"C:\".into(),
            DirNode::new(String::new()),
            Vec::new(),
        ))
    }

    #[test]
    fn keeps_the_result_only_for_the_right_scan() {
        let registry = ScanRegistry::default();
        registry.begin(1);
        registry.store_result(1, empty_tree());
        assert!(registry.result(1).is_some());
        assert!(registry.result(2).is_none());
    }

    #[test]
    fn a_new_scan_frees_the_previous_result() {
        let registry = ScanRegistry::default();
        registry.begin(1);
        registry.store_result(1, empty_tree());
        registry.finish(1);
        registry.begin(2);
        assert!(registry.result(1).is_none());
    }

    #[test]
    fn the_result_of_a_cancelled_scan_is_not_kept() {
        let registry = ScanRegistry::default();
        registry.begin(1);
        registry.begin(2); // cancels 1
        registry.store_result(1, empty_tree());
        assert!(registry.result(1).is_none());
    }
    #[test]
    fn a_new_measurement_cancels_the_previous_one() {
        let state = AppsState::default();
        let first = state.begin_measure();
        let second = state.begin_measure();
        assert!(first.load(Ordering::Relaxed));
        assert!(!second.load(Ordering::Relaxed));
    }

    #[test]
    fn cancelling_without_a_running_measurement() {
        let state = AppsState::default();
        assert!(!state.cancel_measure());
        let flag = state.begin_measure();
        assert!(state.cancel_measure());
        assert!(flag.load(Ordering::Relaxed));
        state.finish_measure(&flag);
        assert!(!state.cancel_measure());
    }

    #[test]
    fn finishing_a_superseded_measurement_leaves_the_new_one_alone() {
        let state = AppsState::default();
        let old = state.begin_measure();
        let new = state.begin_measure();
        state.finish_measure(&old);
        assert!(
            state.cancel_measure(),
            "the new measurement is still registered"
        );
        assert!(new.load(Ordering::Relaxed));
    }
}
