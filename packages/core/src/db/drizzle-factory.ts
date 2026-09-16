import type { SQL } from "drizzle-orm";
import type { AdapterLifecycle } from "../adapters/metadata.ts";
import type { DrizzleAdapterOptions, ListOptions } from "./database.ts";

/** Chainable filter surface shared by dialect select chains. */
export interface ChainFilter<C> {
  where(where: SQL): C;
  orderBy(order: SQL): C;
  limit(n: number): C;
  offset(n: number): C;
}

export function applyListOptions<C extends ChainFilter<C>>(query: C, opts: ListOptions): C {
  let current = query;
  if (opts.where) {
    current = current.where(opts.where);
  }
  if (opts.orderBy) {
    current = current.orderBy(opts.orderBy);
  }
  if (opts.limit !== undefined) {
    current = current.limit(opts.limit);
  }
  if (opts.offset !== undefined) {
    current = current.offset(opts.offset);
  }
  return current;
}

/**
 * Build the database lifecycle: migrations run in `setup`, the connection
 * is destroyed in `teardown`, `health` pings when the driver provides one.
 * Teardown tolerates repeated calls (drivers may not).
 */
export function buildLifecycle(options: DrizzleAdapterOptions): AdapterLifecycle {
  let closed = false;
  return {
    setup: async () => {
      await options.migrate();
    },
    teardown: async () => {
      if (closed) {
        return;
      }
      closed = true;
      await options.close();
    },
    health: async () => {
      if (closed) {
        return { ok: false, detail: "database closed" };
      }
      if (options.ping) {
        await options.ping();
      }
      return { ok: true };
    },
  };
}
