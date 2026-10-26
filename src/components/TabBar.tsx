import type { KeyboardEvent } from "react";
import { TABS, TAB_HINTS } from "../lib/constants";
import { useStore } from "../store";

export function TabBar() {
  const screen = useStore((s) => s.screen);
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const results = screen === "results";

  const onKeyDown = (e: KeyboardEvent) => {
    if (!results) return;
    const i = TABS.findIndex((t) => t.id === tab);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i + TABS.length - 1) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next == null) return;
    e.preventDefault();
    const id = TABS[next].id;
    setTab(id);
    requestAnimationFrame(() => document.getElementById(`tab-${id}`)?.focus());
  };

  return (
    <div className="flex flex-none items-center gap-3 border-b border-border px-4 py-2.5">
      <div
        role="tablist"
        aria-label="Result views"
        onKeyDown={onKeyDown}
        className={`inline-flex gap-0.5 rounded-lg bg-muted p-[3px] ${results ? "" : "opacity-55"}`}
      >
        {TABS.map((t) => {
          const active = results && tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active}
              aria-controls="da-panel"
              tabIndex={tab === t.id ? 0 : -1}
              disabled={!results}
              onClick={() => setTab(t.id)}
              className={`h-7 rounded-md px-3.5 text-[13px] font-medium ${active ? "bg-card text-fg shadow-[0_1px_2px_oklch(0_0_0/0.14)]" : "text-muted-fg"}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="ml-auto truncate text-xs text-muted-fg">{results ? TAB_HINTS[tab] : ""}</div>
    </div>
  );
}
