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
 * Build the database lifecycle: migrations run in `init`, the connection
 * closes in `close`. Close tolerates repeated calls (drivers may not).
 */
export function buildLifecycle(options: DrizzleAdapterOptions): AdapterLifecycle {
  let closed = false;
  return {
    init: async () => {
      await options.migrate();
    },
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      await options.close();
    },
  };
}
