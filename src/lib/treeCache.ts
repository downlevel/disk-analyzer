import type { Node } from "../bindings/Node";
import { fmtInt } from "./format";
import type { TreeNode } from "./types";

/**
 * Nodi dell'albero finora ricevuti dal core Rust, indicizzati per id.
 *
 * Gli oggetti sono mutabili e mantengono la propria identità tra un aggiornamento e l'altro
 * (le viste li confrontano con `===`); chi modifica la cache segnala il cambiamento allo store.
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

  /** Inserisce o aggiorna un nodo; se il padre è già noto lo collega. */
  upsert(dto: Node): TreeNode {
    const parent = dto.parentId != null ? (this.nodes.get(dto.parentId) ?? null) : null;
    const fields = {
      name: dto.kind === "agg" ? `File (${fmtInt(dto.files)})` : dto.name,
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

  /** Registra i figli di un nodo (già ordinati dal core) e li collega al padre. */
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
