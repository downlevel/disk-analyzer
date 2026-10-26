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
  const agg = node({ name: "Files (9)", agg: true, size: 999 });
  const root = node({ name: "root", isDir: true, children: [a, agg, b] });

  it("sorts by size and keeps the aggregate node last", () => {
    expect(sortChildren(root, "size", -1).map((n) => n.name)).toEqual([
      "a.txt",
      "b.txt",
      "Files (9)",
    ]);
    expect(sortChildren(root, "size", 1).map((n) => n.name)).toEqual([
      "b.txt",
      "a.txt",
      "Files (9)",
    ]);
  });

  it("sorts by name", () => {
    expect(sortChildren(root, "name", 1).map((n) => n.name)).toEqual([
      "a.txt",
      "b.txt",
      "Files (9)",
    ]);
  });

  it("does not modify the original order of the children", () => {
    sortChildren(root, "size", -1);
    expect(root.children.map((n) => n.name)).toEqual(["b.txt", "Files (9)", "a.txt"]);
  });
});

describe("dominantType / nodeType", () => {
  it("finds the predominant type of a folder", () => {
    const dir = node({
      name: "d",
      isDir: true,
      byType: { video: 500, doc: 80, other: 20 },
    });
    expect(dominantType(dir)).toBe("video");
    expect(nodeType(dir)).toBe("video");
    expect(dominantType(node({ name: "empty", isDir: true }))).toBe("other");
  });

  it("for files uses the file's type", () => {
    expect(nodeType(file("a.pdf", 5, "doc"))).toBe("doc");
    expect(nodeType(node({ name: "no-type" }))).toBe("other");
  });
});

describe("dirnameOf", () => {
  it("returns the folder containing the file", () => {
    expect(dirnameOf("C:\\Users\\user\\file.txt")).toBe("C:\\Users\\user");
  });

  it("keeps the backslash for a drive root", () => {
    expect(dirnameOf("C:\\file.txt")).toBe("C:\\");
  });

  it("returns the path unchanged if it has no separators", () => {
    expect(dirnameOf("file.txt")).toBe("file.txt");
  });
});
