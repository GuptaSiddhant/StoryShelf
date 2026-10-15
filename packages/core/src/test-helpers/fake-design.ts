/** A scriptable in-memory design provider for model and app tests (links look like `https://design.test/<file>?node=<id>`). */
import { Buffer } from "node:buffer";
import type {
  DesignCallOptions,
  DesignMeta,
  DesignProvider,
  DesignRef,
  DesignState,
} from "../adapters/design.ts";

export const FAKE_PNG = Buffer.from([137, 80, 78, 71]);

/** Mutable behavior and call log of a {@link makeFakeDesign} provider. */
export interface FakeDesign {
  provider: DesignProvider;
  /** File version served; bump it to simulate an edit. */
  version: string;
  lastModified: string;
  /** Per node id (`""` = whole file) state override; defaults to `ok`. */
  states: Map<string, DesignState>;
  /** Node ids the vendor cannot render. */
  unrenderable: Set<string>;
  /** Make every render call throw. */
  failRenders: boolean;
  /** Artificial latency per call, to observe concurrency. */
  delayMs: number;
  /** Credentials the provider was created with, in order. */
  credentials: string[];
  /** How each of those credentials authenticates, in the same order. */
  authTypes: string[];
  metaCalls: { fileKey: string; nodeIds: string[] }[];
  renderCalls: { fileKey: string; nodeIds: string[] }[];
  /** Calls currently in flight and the highest value seen. */
  inFlight: number;
  peak: number;
}

/** Link to a fake file, optionally a node of it. */
export const fakeUrl = (fileKey: string, nodeId?: string): string =>
  `https://design.test/${fileKey}${nodeId ? `?node=${nodeId}` : ""}`;

function parse(raw: string): DesignRef | null {
  try {
    const url = new URL(raw.trim());
    const fileKey = url.pathname.slice(1);
    if (url.hostname !== "design.test" || fileKey === "") return null;
    return {
      fileKey,
      nodeId: url.searchParams.get("node"),
      url: `${url.origin}${url.pathname}${url.search}`,
    };
  } catch {
    return null;
  }
}

/** Create a fake provider whose behavior the test mutates through the returned object. */
export function makeFakeDesign(kind = "fake"): FakeDesign {
  const fake: FakeDesign = {
    provider: undefined as unknown as DesignProvider,
    version: "1",
    lastModified: "2026-01-01T00:00:00Z",
    states: new Map(),
    unrenderable: new Set(),
    failRenders: false,
    delayMs: 0,
    credentials: [],
    authTypes: [],
    metaCalls: [],
    renderCalls: [],
    inFlight: 0,
    peak: 0,
  };
  const tracked = async <T>(work: () => T, options?: DesignCallOptions): Promise<T> => {
    fake.inFlight += 1;
    fake.peak = Math.max(fake.peak, fake.inFlight);
    try {
      if (fake.delayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, fake.delayMs);
        });
      }
      options?.signal?.throwIfAborted();
      return work();
    } finally {
      fake.inFlight -= 1;
    }
  };
  fake.provider = {
    metadata: {
      name: "Fake design",
      version: "0.0.0",
      kind,
      category: "design",
      credentialLabel: "Fake access token",
      credentialHelp: "Any string works.",
      credentialPlaceholder: "fake_…",
      urlHint: "https://design.test/<file>?node=<id>",
      credentialMaxAgeDays: 90,
    },
    parseUrl: parse,
    create: ({ credential, authType }) => {
      fake.credentials.push(credential);
      fake.authTypes.push(authType ?? "token");
      return {
        fetchMetas: async (fileKey, refs, options) => {
          fake.metaCalls.push({ fileKey, nodeIds: refs.map((ref) => ref.nodeId ?? "") });
          return await tracked(() => {
            const metas = new Map<string, DesignMeta>();
            for (const ref of refs) {
              const id = ref.nodeId ?? "";
              const state = fake.states.get(id) ?? "ok";
              metas.set(id, {
                state,
                name: state === "ok" ? `Node ${id || fileKey}` : null,
                version: state === "ok" ? fake.version : null,
                lastModified: state === "ok" ? fake.lastModified : null,
              });
            }
            return metas;
          }, options);
        },
        fetchRenders: async (fileKey, nodeIds, options) => {
          fake.renderCalls.push({ fileKey, nodeIds: [...nodeIds] });
          return await tracked(() => {
            if (fake.failRenders) throw new Error("render failed");
            return new Map(
              nodeIds
                .filter((id) => !fake.unrenderable.has(id))
                .map((id) => [id, FAKE_PNG] as const),
            );
          }, options);
        },
      };
    },
  };
  return fake;
}
