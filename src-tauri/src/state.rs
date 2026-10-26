use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use crate::model::InstalledApp;
use crate::tree::ScanTree;

#[derive(Default)]
struct Inner {
    /// Scansioni in corso, ciascuna con il proprio flag di annullamento.
    active: HashMap<u64, Arc<AtomicBool>>,
    /// Risultato dell'ultima scansione completata (ne viene conservato uno solo).
    result: Option<(u64, Arc<ScanTree>)>,
}

/// Stato condiviso delle scansioni.
///
/// Gli identificativi sono assegnati dal frontend, così può ascoltare gli eventi di una scansione
/// prima ancora di averla avviata, senza perderne nessuno.
#[derive(Default)]
pub struct ScanRegistry {
    inner: Mutex<Inner>,
}

impl ScanRegistry {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Registra una nuova scansione: annulla quelle ancora in corso (ne è attiva una sola) e
    /// libera il risultato precedente.
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

    /// Chiede l'annullamento di una scansione. Restituisce `false` se non è in corso.
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

    /// Conserva il risultato di una scansione, a meno che nel frattempo ne sia iniziata un'altra.
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

/// Elenco delle app installate e misurazione delle loro dimensioni (una alla volta).
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

    /// Avvia una nuova misurazione, annullando quella eventualmente in corso.
    pub fn begin_measure(&self) -> Arc<AtomicBool> {
        let mut cancel = self.cancel.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(previous) = cancel.as_ref() {
            previous.store(true, Ordering::Relaxed);
        }
        let flag = Arc::new(AtomicBool::new(false));
        *cancel = Some(flag.clone());
        flag
    }

    /// Chiede l'annullamento della misurazione in corso. `false` se non ce n'è nessuna.
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

    /// Segna conclusa la misurazione identificata da `flag` (se è ancora quella corrente).
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
    fn cancel_imposta_il_flag() {
        let registry = ScanRegistry::default();
        let flag = registry.begin(1);
        assert!(!flag.load(Ordering::Relaxed));
        assert!(registry.cancel(1));
        assert!(flag.load(Ordering::Relaxed));
    }

    #[test]
    fn cancel_di_scansione_sconosciuta() {
        let registry = ScanRegistry::default();
        assert!(!registry.cancel(42));
    }

    #[test]
    fn una_nuova_scansione_annulla_la_precedente() {
        let registry = ScanRegistry::default();
        let first = registry.begin(1);
        let second = registry.begin(2);
        assert!(first.load(Ordering::Relaxed));
        assert!(!second.load(Ordering::Relaxed));
    }

    #[test]
    fn finish_rimuove_la_scansione() {
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
    fn conserva_il_risultato_solo_per_la_scansione_giusta() {
        let registry = ScanRegistry::default();
        registry.begin(1);
        registry.store_result(1, empty_tree());
        assert!(registry.result(1).is_some());
        assert!(registry.result(2).is_none());
    }

    #[test]
    fn una_nuova_scansione_libera_il_risultato_precedente() {
        let registry = ScanRegistry::default();
        registry.begin(1);
        registry.store_result(1, empty_tree());
        registry.finish(1);
        registry.begin(2);
        assert!(registry.result(1).is_none());
    }

    #[test]
    fn il_risultato_di_una_scansione_annullata_non_viene_conservato() {
        let registry = ScanRegistry::default();
        registry.begin(1);
        registry.begin(2); // annulla la 1
        registry.store_result(1, empty_tree());
        assert!(registry.result(1).is_none());
    }
    #[test]
    fn una_nuova_misurazione_annulla_la_precedente() {
        let state = AppsState::default();
        let first = state.begin_measure();
        let second = state.begin_measure();
        assert!(first.load(Ordering::Relaxed));
        assert!(!second.load(Ordering::Relaxed));
    }

    #[test]
    fn annullare_senza_misurazione_in_corso() {
        let state = AppsState::default();
        assert!(!state.cancel_measure());
        let flag = state.begin_measure();
        assert!(state.cancel_measure());
        assert!(flag.load(Ordering::Relaxed));
        state.finish_measure(&flag);
        assert!(!state.cancel_measure());
    }

    #[test]
    fn terminare_una_misurazione_superata_non_tocca_quella_nuova() {
        let state = AppsState::default();
        let old = state.begin_measure();
        let new = state.begin_measure();
        state.finish_measure(&old);
        assert!(
            state.cancel_measure(),
            "la misurazione nuova è ancora registrata"
        );
        assert!(new.load(Ordering::Relaxed));
    }
}
