import type { Node } from "../bindings/Node";
import { fmtInt } from "./format";
import type { TreeNode } from "./types";

/**
 * Tree nodes received so far from the Rust core, indexed by id.
 *
 * The objects are mutable and keep their identity across updates
 * (views compare them with `===`); whoever modifies the cache signals the change to the store.
 */
export class TreeCache {
  private nodes = new Map<number, TreeNode>();

  get(id: number): TreeNode | undefined {
    return this.nodes.get(id);
  }

  clear() {
    this.nodes.clear();
  }

  get size() {
    return this.nodes.size;
  }

  /** Inserts or updates a node; if the parent is already known, links it. */
  upsert(dto: Node): TreeNode {
    const parent = dto.parentId != null ? (this.nodes.get(dto.parentId) ?? null) : null;
    const fields = {
      name: dto.kind === "agg" ? `Files (${fmtInt(dto.files)})` : dto.name,
      path: dto.path,
      parentId: dto.parentId,
      isDir: dto.kind === "dir" || dto.kind === "denied",
      denied: dto.kind === "denied" || undefined,
      agg: dto.kind === "agg" || undefined,
      childCount: dto.childCount,
      size: dto.size,
      disk: dto.disk,
      files: dto.files,
      dirs: dto.dirs,
      type: dto.fileType ?? undefined,
      ext: dto.ext ?? undefined,
      modified: dto.modified ?? undefined,
      byType: { ...dto.byType },
    };

    const existing = this.nodes.get(dto.id);
    if (existing) {
      Object.assign(existing, fields);
      existing.parent ??= parent;
      return existing;
    }
    const node: TreeNode = {
      id: dto.id,
      parent,
      children: [],
      childrenLoaded: false,
      ...fields,
    };
    this.nodes.set(node.id, node);
    return node;
  }

  /** Records a node's children (already sorted by the core) and links them to the parent. */
  setChildren(parentId: number, dtos: Node[]): TreeNode[] {
    const parent = this.nodes.get(parentId);
    const children = dtos.map((dto) => this.upsert(dto));
    if (parent) {
      for (const c of children) c.parent = parent;
      parent.children = children;
      parent.childrenLoaded = true;
    }
    return children;
  }
}
