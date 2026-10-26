import { describe, expect, it } from "vitest";
import { dirnameOf, dominantType, nodeType, sortChildren } from "./tree";
import type { FileType, TreeNode } from "./types";

let nextId = 1;

function node(partial: Partial<TreeNode> & { name: string }): TreeNode {
  return {
    id: nextId++,
    path: partial.name,
    parent: null,
    parentId: null,
    isDir: false,
    children: [],
    childCount: 0,
    childrenLoaded: false,
    size: 0,
    disk: 0,
    files: 0,
    dirs: 0,
    byType: {},
    ...partial,
  };
}

const file = (name: string, size: number, type: FileType) =>
  node({ name, size, files: 1, type, byType: { [type]: size } });

describe("sortChildren", () => {
  const a = file("b.txt", 10, "other");
  const b = file("a.txt", 30, "other");
  const agg = node({ name: "File (9)", agg: true, size: 999 });
  const root = node({ name: "root", isDir: true, children: [a, agg, b] });

  it("ordina per dimensione e tiene in fondo il nodo aggregato", () => {
    expect(sortChildren(root, "size", -1).map((n) => n.name)).toEqual([
      "a.txt",
      "b.txt",
      "File (9)",
    ]);
    expect(sortChildren(root, "size", 1).map((n) => n.name)).toEqual([
      "b.txt",
      "a.txt",
      "File (9)",
    ]);
  });

  it("ordina per nome", () => {
    expect(sortChildren(root, "name", 1).map((n) => n.name)).toEqual([
      "a.txt",
      "b.txt",
      "File (9)",
    ]);
  });

  it("non modifica l'ordine originale dei figli", () => {
    sortChildren(root, "size", -1);
    expect(root.children.map((n) => n.name)).toEqual(["b.txt", "File (9)", "a.txt"]);
  });
});

describe("dominantType / nodeType", () => {
  it("trova il tipo prevalente di una cartella", () => {
    const dir = node({
      name: "d",
      isDir: true,
      byType: { video: 500, doc: 80, other: 20 },
    });
    expect(dominantType(dir)).toBe("video");
    expect(nodeType(dir)).toBe("video");
    expect(dominantType(node({ name: "vuota", isDir: true }))).toBe("other");
  });

  it("per i file usa il tipo del file", () => {
    expect(nodeType(file("a.pdf", 5, "doc"))).toBe("doc");
    expect(nodeType(node({ name: "senza-tipo" }))).toBe("other");
  });
});

describe("dirnameOf", () => {
  it("restituisce la cartella che contiene il file", () => {
    expect(dirnameOf("C:\\Users\\marco\\file.txt")).toBe("C:\\Users\\marco");
  });

  it("mantiene la barra per la radice di un'unità", () => {
    expect(dirnameOf("C:\\file.txt")).toBe("C:\\");
  });

  it("restituisce il percorso invariato se non ha separatori", () => {
    expect(dirnameOf("file.txt")).toBe("file.txt");
  });
});
