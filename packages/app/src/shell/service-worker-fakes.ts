import { createHash } from "node:crypto";

/* oxlint-disable typescript/promise-function-async -- fakes return pre-resolved promises */

/** Test doubles for the worker's environment: a fake server, IndexedDB and Cache Storage. */

export const ORIGIN = "https://shelf.test";

export const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

/** A project of the fake server: its latest default-branch build's files by path. */
export interface FakeBuild {
  slug: string;
  buildId: string;
  commit?: string;
  files: Record<string, string>;
  maxOfflineDays?: number;
}

/** A fake server answering the sync endpoint and the published file routes; counts file downloads. */
export class FakeServer {
  builds = new Map<string, FakeBuild>();
  status = 200;
  online = true;
  downloads: string[] = [];
  requests: string[] = [];
  corrupt = false;
  /** Answers as a deployment outside `trusted` hosting mode does. */
  hostingOff = false;

  handle(input: string | { url: string }): Response {
    const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
    this.requests.push(url.pathname);
    if (!this.online) throw new TypeError("offline");
    if (url.pathname === "/api/v1/offline") return this.sync(url);
    const match = /^\/projects\/(?<slug>[^/]+)\/storybook\/build\/(?<id>[^/]+)\/(?<path>.+)$/u.exec(
      url.pathname,
    );
    const build = this.builds.get(match?.groups?.["slug"] ?? "");
    const body = build?.files[decodeURIComponent(match?.groups?.["path"] ?? "")];
    if (body === undefined) return new Response("no", { status: 404 });
    this.downloads.push(url.pathname);
    return new Response(this.corrupt ? "tampered" : body);
  }

  private sync(url: URL): Response {
    if (this.status !== 200) return new Response("", { status: this.status });
    if (this.hostingOff) {
      return Response.json({ projects: [], reason: "hosting-mode", hostingMode: "sandboxed" });
    }
    const slugs = (url.searchParams.get("projects") ?? "").split(",");
    const projects = slugs.flatMap((slug) => {
      const build = this.builds.get(slug);
      if (!build) return [];
      const entries = Object.entries(build.files).map(([path, text]) => ({
        path,
        hash: sha(text),
        size: text.length,
      }));
      return [
        {
          slug,
          name: `Name ${slug}`,
          buildId: build.buildId,
          commit: build.commit ?? "abcdef1234567",
          entries,
          maxOfflineDays: build.maxOfflineDays ?? 30,
        },
      ];
    });
    return Response.json({ projects });
  }
}

const later = (fn: () => void): void => {
  setTimeout(fn, 0);
};

interface FakeRequest {
  result?: unknown;
  onupgradeneeded?: () => void;
  onsuccess?: () => void;
}
interface FakeTx {
  oncomplete?: () => void;
  objectStore: () => {
    get: (key: string) => FakeRequest;
    put: (value: unknown, key: string) => FakeRequest;
  };
}

/** A tiny IndexedDB: one database with one store of structured-cloned values. */
export function fakeIndexedDb(data: Map<string, unknown>): { open: () => FakeRequest } {
  const transaction = (): FakeTx => {
    const tx: FakeTx = {
      objectStore: () => ({
        get: (key) => {
          later(() => tx.oncomplete?.());
          return { result: structuredClone(data.get(key)) };
        },
        put: (value, key) => {
          data.set(key, structuredClone(value));
          later(() => tx.oncomplete?.());
          return { result: key };
        },
      }),
    };
    return tx;
  };
  return {
    open: () => {
      const request: FakeRequest = {
        result: { close: () => null, createObjectStore: () => null, transaction },
      };
      later(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

export interface Stored {
  body: Buffer;
  headers: Headers;
}
export type CacheStore = Map<string, Map<string, Stored>>;

const keyOf = (key: string | { url: string }): string => (typeof key === "string" ? key : key.url);

function fakeCache(entries: Map<string, Stored>): unknown {
  return {
    match: (key: string) => {
      const hit = entries.get(keyOf(key));
      return Promise.resolve(
        hit ? new Response(new Uint8Array(hit.body), { headers: hit.headers }) : undefined,
      );
    },
    put: async (key: string, res: Response) => {
      entries.set(keyOf(key), { body: Buffer.from(await res.arrayBuffer()), headers: res.headers });
    },
    keys: () => Promise.resolve([...entries.keys()].map((url) => ({ url }))),
    delete: (key: string | { url: string }) => Promise.resolve(entries.delete(keyOf(key))),
  };
}

/** In-memory Cache Storage: named caches of url → bytes and headers. */
export function fakeCaches(store: CacheStore): unknown {
  return {
    delete: (name: string) => Promise.resolve(store.delete(name)),
    open: (name: string) => {
      const entries = store.get(name) ?? new Map<string, Stored>();
      store.set(name, entries);
      return Promise.resolve(fakeCache(entries));
    },
  };
}
