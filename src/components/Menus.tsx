import { Copy, ExternalLink, Folder, FolderOpen, LayoutGrid, ListTree } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useStore } from "../store";

const MENU_ITEM =
  "flex w-full items-center rounded-[5px] text-left outline-none hover:bg-hover focus:bg-hover";

/** Navigazione da tastiera comune ai menu: frecce, Home/End, Esc/Tab per chiudere. */
function useMenuKeys(ref: React.RefObject<HTMLDivElement | null>, close: () => void) {
  return (e: KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
}

function Backdrop({ onClose, preventContext }: { onClose: () => void; preventContext?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-40"
      onMouseDown={onClose}
      onContextMenu={
        preventContext
          ? (e) => {
              e.preventDefault();
              onClose();
            }
          : undefined
      }
    />
  );
}

function Separator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-border" />;
}

export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const act = useStore((s) => s.act);
  const closeMenus = useStore((s) => s.closeMenus);
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = useMenuKeys(ref, closeMenus);

  useEffect(() => {
    if (!menu) return;
    const t = setTimeout(() => {
      const first = ref.current?.querySelector<HTMLElement>("[role=menuitem]");
      (menu.keyboard ? first : ref.current)?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [menu]);

  if (!menu) return null;
  const { node, from } = menu;
  const canShowInMap = node.isDir && !node.denied && node.childCount > 0;

  const item = (icon: ReactNode, label: string, onClick: () => void, kbd = "") => (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`${MENU_ITEM} h-8 gap-2.5 px-2`}
    >
      <span className="text-muted-fg">{icon}</span>
      <span className="flex-1">{label}</span>
      <span className="text-[11.5px] text-muted-fg">{kbd}</span>
    </button>
  );

  return (
    <>
      <Backdrop onClose={closeMenus} preventContext />
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
        aria-label="Azioni elemento"
        onKeyDown={onKeyDown}
        style={{ left: menu.x, top: menu.y }}
        className="fixed z-[41] w-60 rounded-lg border border-border bg-popover p-1 shadow-pop outline-none"
      >
        <div className="truncate px-2 py-1.5 text-[11.5px] text-muted-fg">{node.path}</div>
        {item(<ExternalLink size={15} />, "Apri in Esplora risorse", () => act("open", node))}
        {item(<Copy size={15} />, "Copia percorso", () => act("copy", node), "Ctrl+C")}
        {canShowInMap && from !== "map" && (
          <>
            <Separator />
            {item(<LayoutGrid size={15} />, "Mostra nella treemap", () => act("map", node))}
          </>
        )}
        {from !== "tree" && (
          <>
            <Separator />
            {item(<ListTree size={15} />, "Mostra nell'albero", () => act("tree", node))}
          </>
        )}
      </div>
    </>
  );
}

export function FolderPicker() {
  const picker = useStore((s) => s.picker);
  const startScan = useStore((s) => s.startScan);
  const closeMenus = useStore((s) => s.closeMenus);
  const recents = useStore((s) => s.recents);
  const browseFolder = useStore((s) => s.browseFolder);
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = useMenuKeys(ref, closeMenus);

  useEffect(() => {
    if (!picker) return;
    const t = setTimeout(
      () => ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus(),
      0,
    );
    return () => clearTimeout(t);
  }, [picker]);

  if (!picker) return null;

  return (
    <>
      <Backdrop onClose={closeMenus} />
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
        aria-label="Scegli cartella"
        onKeyDown={onKeyDown}
        style={{ left: picker.x, top: picker.y }}
        className="fixed z-[41] w-[310px] rounded-lg border border-border bg-popover p-1 shadow-pop outline-none"
      >
        <div className="px-2 py-1.5 text-[11.5px] text-muted-fg">Cartelle recenti</div>
        {recents.length === 0 && (
          <div className="px-2 py-2 text-muted-fg">Nessuna cartella recente</div>
        )}
        {recents.map((path) => (
          <button
            key={path}
            type="button"
            role="menuitem"
            onClick={() => startScan({ path })}
            className={`${MENU_ITEM} gap-2.5 px-2 py-[7px]`}
          >
            <Folder size={15} className="flex-none text-muted-fg" />
            <span className="truncate">{path}</span>
          </button>
        ))}
        <Separator />
        <button
          type="button"
          role="menuitem"
          onClick={() => void browseFolder()}
          className={`${MENU_ITEM} h-8 gap-2.5 px-2`}
        >
          <FolderOpen size={15} className="flex-none text-muted-fg" />
          Sfoglia…
        </button>
      </div>
    </>
  );
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-10 z-50 flex max-w-[420px] items-center gap-2 rounded-lg border border-border bg-popover px-3.5 py-2.5 text-[12.5px] shadow-pop"
    >
      <span className="size-[7px] flex-none rounded-full bg-ok" />
      <span className="truncate">{toast}</span>
    </div>
  );
}
