import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import {
  FakeServer,
  ORIGIN,
  fakeCaches,
  fakeIndexedDb,
  type CacheStore,
} from "./service-worker-fakes.ts";
import { serviceWorkerScript } from "./service-worker.ts";

/* oxlint-disable typescript/promise-function-async -- fakes return pre-resolved promises */

/** Test helper: runs the worker script against in-memory IndexedDB, Cache Storage and a fake server. */

export { sha, type FakeBuild } from "./service-worker-fakes.ts";

type Listener = (event: unknown) => void;

/** What the worker answers a page message with. */
export interface Reply {
  ok: boolean;
  error?: string;
  size?: number;
  usage: {
    usedBytes: number;
    capBytes: number;
    persisted: boolean;
    projects: { slug: string; size: number; expired: boolean; commit: string }[];
  };
}

export interface Worker {
  server: FakeServer;
  idb: Map<string, unknown>;
  caches: CacheStore;
  /** Fire a fetch event; resolves with the worker's answer, or rejects with the passed-through failure. */
  fetch: (path: string, init?: { mode?: string; method?: string }) => Promise<Response>;
  /** Post a page message and wait for the worker's answer (undefined when it ignored the sender). */
  send: (data: unknown, from?: string) => Promise<Reply | undefined>;
}

type Shared = Pick<Worker, "idb" | "caches" | "server">;

function sandboxOf(shared: Shared, listeners: Map<string, Listener>): Record<string, unknown> {
  return {
    self: {
      addEventListener: (name: string, fn: Listener) => listeners.set(name, fn),
      skipWaiting: () => null,
      clients: { claim: () => Promise.resolve() },
      location: { origin: ORIGIN },
    },
    fetch: async (input: string | { url: string }) =>
      await Promise.resolve(shared.server.handle(input)),
    Response,
    URL,
    Date,
    crypto: webcrypto,
    setTimeout,
    Uint8Array,
    navigator: { storage: { persisted: () => Promise.resolve(true) } },
    indexedDB: fakeIndexedDb(shared.idb),
    caches: fakeCaches(shared.caches),
  };
}

/** Fire a listener's event and wait for everything it passed to `waitUntil`. */
async function fire(
  listeners: Map<string, Listener>,
  name: string,
  event: Record<string, unknown>,
): Promise<void> {
  const waits: Promise<unknown>[] = [];
  listeners.get(name)?.({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
}

/** Load the worker in a sandbox. `existing` shares device state across "restarts" of the worker. */
export function loadWorker(existing?: Shared): Worker {
  const shared: Shared = existing ?? {
    server: new FakeServer(),
    idb: new Map<string, unknown>(),
    caches: new Map(),
  };
  const listeners = new Map<string, Listener>();
  runInNewContext(serviceWorkerScript(), sandboxOf(shared, listeners));
  return {
    ...shared,
    fetch: async (path, init = {}) => {
      const answers: Promise<Response>[] = [];
      listeners.get("fetch")?.({
        request: {
          url: new URL(path, ORIGIN).href,
          mode: init.mode ?? "cors",
          method: init.method ?? "GET",
        },
        respondWith: (p: Promise<Response>) => answers.push(p),
      });
      const [answer] = answers;
      if (!answer) throw new Error("worker did not respond");
      return await answer;
    },
    send: async (data, from = `${ORIGIN}/`) => {
      let reply: Reply | undefined;
      const port = {
        postMessage: (value: Reply): void => {
          reply = value;
        },
      };
      await fire(listeners, "message", { data, source: { url: from }, ports: [port] });
      return reply;
    },
  };
}
