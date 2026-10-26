import { beforeEach, describe, expect, it } from "vitest";
import type { Node } from "../bindings/Node";
import { TreeCache } from "./treeCache";

const noTypes = { video: 0, img: 0, doc: 0, code: 0, arch: 0, other: 0 };

function dto(partial: Partial<Node> & { id: number }): Node {
  return {
    parentId: null,
    name: `n${partial.id}`,
    path: `C:\\n${partial.id}`,
    kind: "dir",
    size: 0,
    disk: 0,
    files: 0,
    dirs: 0,
    fileType: null,
    ext: null,
    modified: null,
    childCount: 0,
    byType: noTypes,
    ...partial,
  };
}

let cache: TreeCache;
beforeEach(() => {
  cache = new TreeCache();
});

describe("TreeCache", () => {
  it("converts the core's fields into the UI model", () => {
    const file = cache.upsert(
      dto({
        id: 5,
        kind: "file",
        name: "film.mp4",
        size: 100,
        fileType: "video",
        ext: ".mp4",
        modified: "Nov 14, 2023",
        byType: { ...noTypes, video: 100 },
      }),
    );
    expect(file).toMatchObject({
      id: 5,
      isDir: false,
      type: "video",
      ext: ".mp4",
      modified: "Nov 14, 2023",
      childrenLoaded: false,
    });
    expect(file.byType.video).toBe(100);
    expect(file.denied).toBeUndefined();
  });

  it("recognizes inaccessible folders and aggregate nodes", () => {
    const denied = cache.upsert(dto({ id: 1, kind: "denied" }));
    expect(denied).toMatchObject({ isDir: true, denied: true });

    const agg = cache.upsert(dto({ id: 2, kind: "agg", name: "", files: 12345, fileType: "doc" }));
    expect(agg.agg).toBe(true);
    expect(agg.isDir).toBe(false);
    expect(agg.name).toBe("Files (12,345)");
  });

  it("links the children to the parent and marks them as loaded", () => {
    const root = cache.upsert(dto({ id: 0, childCount: 2 }));
    const kids = cache.setChildren(0, [
      dto({ id: 1, parentId: 0 }),
      dto({ id: 2, parentId: 0, kind: "file" }),
    ]);
    expect(root.childrenLoaded).toBe(true);
    expect(root.children).toEqual(kids);
    expect(kids.every((k) => k.parent === root)).toBe(true);
  });

  it("keeps object identity when a node is updated", () => {
    const first = cache.upsert(dto({ id: 1, size: 10 }));
    const second = cache.upsert(dto({ id: 1, size: 99 }));
    expect(second).toBe(first);
    expect(first.size).toBe(99);
  });

  it("a reloaded node keeps its already-known children", () => {
    cache.upsert(dto({ id: 0, childCount: 1 }));
    cache.setChildren(0, [dto({ id: 1, parentId: 0 })]);
    const again = cache.upsert(dto({ id: 0, childCount: 1, size: 7 }));
    expect(again.childrenLoaded).toBe(true);
    expect(again.children).toHaveLength(1);
  });

  it("links the parent if it is already cached, even for nodes loaded on their own", () => {
    const root = cache.upsert(dto({ id: 0 }));
    const orphan = cache.upsert(dto({ id: 9, parentId: 0 }));
    expect(orphan.parent).toBe(root);
    // Unknown parent: no link, but the parent id remains available.
    const lost = cache.upsert(dto({ id: 10, parentId: 77 }));
    expect(lost.parent).toBeNull();
    expect(lost.parentId).toBe(77);
  });

  it("clears the cache", () => {
    cache.upsert(dto({ id: 1 }));
    cache.clear();
    expect(cache.get(1)).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
