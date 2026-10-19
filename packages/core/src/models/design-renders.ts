/** Persistence of cached design node renders: PNGs in storage, version-tracked on the `design_nodes` row. */
import type { Table } from "drizzle-orm";
import type { Buffer } from "node:buffer";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { DesignCallOptions, DesignClient } from "../adapters/design.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { Logger } from "../logger.ts";
import type { DesignNode } from "../schema/design.ts";
import { designRenderPath } from "../utils/paths.ts";

/**
 * Renders live at `{projectId}/design/{provider}/{fileKey}/{node}.png` (a member's own
 * connection: `…/{provider}/user-{id}/{fileKey}/…`), one per
 * linked node and overwritten in place when the file version moves, so storage
 * is bounded by the number of distinct linked nodes. A deleted node drops its
 * render; a link removed from settings (or a deleted project) leaves its PNG behind.
 */
export class DesignRenderStore {
  private readonly db: DatabaseAdapter;
  private readonly table: Table;
  private readonly storage: StorageAdapter | undefined;
  private readonly logger: Logger | undefined;

  constructor(
    db: DatabaseAdapter,
    table: Table,
    storage: StorageAdapter | undefined,
    logger: Logger | undefined,
  ) {
    this.db = db;
    this.table = table;
    this.storage = storage;
    this.logger = logger;
  }

  /** Cached render bytes of a node, or null when it has none (or storage is not wired). */
  async read(node: DesignNode): Promise<Buffer | null> {
    if (!this.storage || !node.renderPath) return null;
    return await this.storage.read(node.renderPath).catch(() => null);
  }

  /** Delete a node's stored render (its row is cleared by the caller's update). */
  async remove(node: DesignNode): Promise<void> {
    if (node.renderPath) await this.storage?.delete(node.renderPath).catch(() => {});
  }

  /**
   * Fetch renders (one call per file) for the ok node rows that are missing one
   * or hold an older file version, keyed by link URL. Failures keep the previous
   * render and the row unchanged.
   */
  async ensure(
    projectId: string,
    client: DesignClient,
    fileKey: string,
    stored: Map<string, DesignNode>,
    call: DesignCallOptions,
  ): Promise<Map<string, DesignNode>> {
    const needing = [...stored].filter(([, node]) => needsRender(node));
    if (!this.storage || needing.length === 0) return stored;
    try {
      const renders = await client.fetchRenders(
        fileKey,
        needing.map(([, node]) => node.nodeId),
        call,
      );
      const saved = await Promise.all(
        needing.map(async ([url, node]) => {
          const png = renders.get(node.nodeId);
          return png ? ([url, await this.save(projectId, node, png)] as const) : null;
        }),
      );
      for (const entry of saved) {
        if (entry) stored.set(entry[0], entry[1]);
      }
    } catch (error) {
      this.logger?.warn(
        { err: error, fileKey, nodes: needing.length },
        "design render fetch failed",
      );
    }
    return stored;
  }

  private async save(projectId: string, node: DesignNode, png: Buffer): Promise<DesignNode> {
    const path = designRenderPath(
      projectId,
      node.provider,
      node.fileKey,
      node.nodeId,
      node.viewerId,
    );
    await this.storage?.write(path, png);
    return (await this.db.update(this.table, node.id, {
      renderPath: path,
      renderVersion: node.version,
      updatedAt: new Date().toISOString(),
    })) as unknown as DesignNode;
  }
}

/** An ok node row whose render is missing or taken at an older file version. */
function needsRender(node: DesignNode): boolean {
  return (
    node.state === "ok" &&
    node.nodeId !== "" &&
    node.version !== null &&
    node.renderVersion !== node.version
  );
}
