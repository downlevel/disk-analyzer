import type { MouseEvent } from "react";
import { useEffect, useState } from "react";
import type { MenuSource, TreeNode } from "./lib/types";
import { useStore } from "./store";

/** Apre il menu contestuale di un nodo alle coordinate indicate, tenendolo dentro la finestra. */
export function openMenuAt(
  x: number,
  y: number,
  node: TreeNode,
  from: MenuSource,
  keyboard: boolean,
) {
  useStore.getState().openMenu({
    x: Math.min(x, window.innerWidth - 250),
    y: Math.min(y, window.innerHeight - 170),
    node,
    from,
    keyboard,
  });
}

export function openNodeMenu(e: MouseEvent, node: TreeNode, from: MenuSource) {
  e.preventDefault();
  e.stopPropagation();
  openMenuAt(e.clientX, e.clientY, node, from, false);
}

export function useWindowWidth(): number {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/** La sidebar si comprime sotto i 1000px, salvo scelta manuale dell'utente. */
export function useSidebarCollapsed(): [boolean, () => void] {
  const width = useWindowWidth();
  const manual = useStore((s) => s.sidebarManual);
  const setManual = useStore((s) => s.setSidebarManual);
  const collapsed = manual ?? width < 1000;
  return [collapsed, () => setManual(!collapsed)];
}

/** Apre il selettore cartelle ancorato al pulsante cliccato. */
export function openPickerFrom(e: MouseEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  const side = r.width < 80;
  const x = Math.min(side ? r.right + 6 : r.left, window.innerWidth - 320);
  const y = Math.min(side ? r.top : r.bottom + 4, window.innerHeight - 300);
  useStore.getState().openPicker({ x, y });
}
