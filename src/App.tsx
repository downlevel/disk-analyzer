import { useEffect } from "react";
import { AppsView } from "./components/AppsView";
import { ContextMenu, FolderPicker, Toast } from "./components/Menus";
import { Sidebar } from "./components/Sidebar";
import { EmptyState, ErrorView, ScanningView } from "./components/StateScreens";
import { StatusBar } from "./components/StatusBar";
import { TabBar } from "./components/TabBar";
import { Toolbar } from "./components/Toolbar";
import { TopFilesView } from "./components/TopFilesView";
import { TreeView } from "./components/TreeView";
import { TreemapView } from "./components/TreemapView";
import { TypesView } from "./components/TypesView";
import { useStore } from "./store";

function Panel() {
  const screen = useStore((s) => s.screen);
  const tab = useStore((s) => s.tab);
  const root = useStore((s) => s.root);

  if (screen === "empty") return <EmptyState />;
  if (screen === "scanning") return <ScanningView />;
  if (screen === "error") return <ErrorView />;
  if (!root) return null;

  switch (tab) {
    case "tree":
      return <TreeView root={root} />;
    case "map":
      return <TreemapView root={root} />;
    case "top":
      return <TopFilesView />;
    case "types":
      return <TypesView />;
  }
}

export default function App() {
  const tab = useStore((s) => s.tab);
  const section = useStore((s) => s.section);

  // Elenco delle unità: all'avvio e ogni volta che la finestra torna in primo piano (lo spazio
  // libero cambia anche fuori dall'app, es. cancellando file da Esplora risorse).
  useEffect(() => {
    const refresh = () => void useStore.getState().loadDrives();
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  // Scorciatoie globali: Esc chiude i menu, F5 riscansiona.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (e.key === "Escape" && (s.menu || s.picker)) s.closeMenus();
      if (e.key === "F5") {
        e.preventDefault();
        if (s.section === "apps") void s.measureApps();
        else if (s.target) s.startScan(s.target);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen min-w-[900px] flex-col overflow-hidden bg-bg text-fg">
      <header>
        <h1 className="sr-only">Disk Analyzer</h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          {section === "apps" ? (
            <AppsView />
          ) : (
            <>
              <Toolbar />
              <TabBar />
              <div
                id="da-panel"
                role="tabpanel"
                aria-labelledby={`tab-${tab}`}
                className="relative flex min-h-0 flex-1 flex-col"
              >
                <Panel />
              </div>
            </>
          )}
          {/* Menu e avvisi sono a posizione fissa; stanno dentro `main` per far parte di una regione. */}
          <ContextMenu />
          <FolderPicker />
          <Toast />
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
