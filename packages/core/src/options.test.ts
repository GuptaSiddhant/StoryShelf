import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CaptureRunner } from "./adapters/capture-runner.ts";
import type { ShelfOptions } from "./config.ts";
import {
  DEFAULT_SCRATCH_DIR,
  resolveShelfOptions,
  sequentialTransactionsWarning,
} from "./options.ts";
import { makeFakeDesign } from "./test-helpers/fake-design.ts";

const runner = { metadata: { kind: "r" } } as unknown as CaptureRunner;
const base = {
  database: { metadata: { name: "Fake", kind: "fake", category: "database" } },
  storage: {},
} as unknown as ShelfOptions;

describe("resolveShelfOptions", () => {
  it("resolves the integration groups into lists (ADR 0049)", () => {
    const design = makeFakeDesign().provider;
    const resolved = resolveShelfOptions({
      ...base,
      design: (builtIn) => [...builtIn, design],
      notifications: { notifiers: false, config: { fromName: "Shelf" } },
    });
    expect(resolved.design?.map((p) => p.metadata.kind)).toEqual(["figma", "fake"]);
    expect(resolved.notifications?.notifiers).toEqual([]);
    expect(resolved.notifications?.email).toEqual([]);
    expect(resolved.notifications?.config).toEqual({ fromName: "Shelf" });
  });

  it("throws at startup on a repeated provider kind, naming it", () => {
    const design = makeFakeDesign("figma").provider;
    expect(() => resolveShelfOptions({ ...base, design: [design, design] })).toThrow(
      /design\[1\] \(".*"\): kind "figma" is already used/u,
    );
  });

  it("defaults scratchDir for a hosting-only deployment: publishing extracts zips there", () => {
    expect(resolveShelfOptions(base).config?.scratchDir).toBe(DEFAULT_SCRATCH_DIR);
  });

  it("defaults scratchDir when a runner needs it", () => {
    expect(DEFAULT_SCRATCH_DIR).toBe(join(tmpdir(), "storyshelf"));
    const resolved = resolveShelfOptions({ ...base, testing: { runner } });
    expect(resolved.config?.scratchDir).toBe(DEFAULT_SCRATCH_DIR);
  });

  it("keeps the other config keys when defaulting scratchDir", () => {
    const resolved = resolveShelfOptions({ ...base, config: { maxInlineUnzipSize: 10 } });
    expect(resolved.config).toEqual({ maxInlineUnzipSize: 10, scratchDir: DEFAULT_SCRATCH_DIR });
  });

  it("keeps an explicit scratchDir and the rest of the config", () => {
    const resolved = resolveShelfOptions({
      ...base,
      testing: { runner },
      config: { scratchDir: "/data", purgeTtlDays: 7 },
    });
    expect(resolved.config).toEqual({ scratchDir: "/data", purgeTtlDays: 7 });
  });

  it("validates testing.compare.threads", () => {
    expect(() =>
      resolveShelfOptions({ ...base, testing: { runner, compare: { threads: -1 } } }),
    ).toThrow(/testing\.compare\.threads/u);
    expect(() =>
      resolveShelfOptions({ ...base, testing: { runner, compare: { threads: 1.5 } } }),
    ).toThrow(/testing\.compare\.threads/u);
    expect(
      resolveShelfOptions({ ...base, testing: { runner, compare: { threads: 0 } } }).testing
        ?.compare?.threads,
    ).toBe(0);
  });

  it("requires a runner whenever testing is set", () => {
    expect(() => resolveShelfOptions({ ...base, testing: {} as never })).toThrow(
      /testing requires testing\.runner/u,
    );
    expect(() => resolveShelfOptions({ ...base, testing: { concurrency: 2 } as never })).toThrow(
      /testing requires testing\.runner/u,
    );
  });

  it("refuses testing on a database that cannot back it, but hosts on it", () => {
    const d1 = {
      ...base,
      database: { metadata: { name: "Cloudflare D1", supportsTesting: false } },
    } as unknown as ShelfOptions;
    expect(() => resolveShelfOptions({ ...d1, testing: { runner } })).toThrow(
      /Cloudflare D1 database cannot back testing/u,
    );
    expect(resolveShelfOptions(d1).testing).toBeUndefined();
  });

  it("validates notifications.config", () => {
    expect(() =>
      resolveShelfOptions({ ...base, notifications: { config: { fromEmail: "" } } }),
    ).toThrow(/notifications\.config/u);
    expect(() =>
      resolveShelfOptions({ ...base, notifications: { config: { fromEmail: "a@b.c" } } }),
    ).not.toThrow();
  });
});

function shardSized(shardSize: number, extra = {}): () => void {
  return () => {
    resolveShelfOptions({ ...base, testing: { runner, shardSize, ...extra } });
  };
}

function hosted(mode: string, extra: Partial<ShelfOptions> = {}): () => void {
  return () => {
    resolveShelfOptions({
      ...base,
      ...extra,
      config: { secret: undefined, ...extra.config, storybookHosting: { mode } },
    } as unknown as ShelfOptions);
  };
}

function rateLimited(storybookUrlRateLimit: number): () => void {
  return () => {
    resolveShelfOptions({ ...base, testing: { runner, storybookUrlRateLimit } });
  };
}

function withRetries(retries: number): () => void {
  return () => {
    resolveShelfOptions({ ...base, testing: { runner, retries } });
  };
}

function lease(leaseSeconds: number): () => void {
  return () => {
    resolveShelfOptions({ ...base, testing: { runner, leaseSeconds } });
  };
}

function maxJob(maxJobSeconds: number): () => void {
  return () => {
    resolveShelfOptions({ ...base, testing: { runner, maxJobSeconds } });
  };
}

function concurrent(concurrency: number): () => void {
  return () => {
    resolveShelfOptions({ ...base, testing: { runner, concurrency } });
  };
}

describe("resolveShelfOptions testing process options", () => {
  it("requires a runner alongside workerEntry", () => {
    expect(() =>
      resolveShelfOptions({ ...base, testing: { workerEntry: "/app/capture-worker.ts" } as never }),
    ).toThrow(/requires testing\.runner/u);
  });

  it("validates shardSize", () => {
    expect(shardSized(100)).not.toThrow();
    expect(shardSized(0)).toThrow(/positive integer/u);
    expect(shardSized(1.5)).toThrow(/positive integer/u);
    expect(shardSized(10, { workerEntry: "/app/w.ts" })).not.toThrow();
    expect(() => resolveShelfOptions({ ...base, testing: { shardSize: 10 } as never })).toThrow(
      /requires testing\.runner/u,
    );
  });

  it("validates storybookUrlRateLimit as a positive whole number", () => {
    expect(rateLimited(6000)).not.toThrow();
    expect(rateLimited(1)).not.toThrow();
    expect(rateLimited(0)).toThrow(/storybookUrlRateLimit/u);
    expect(rateLimited(2.5)).toThrow(/storybookUrlRateLimit/u);
  });

  it("validates concurrency as a positive integer", () => {
    expect(concurrent(2)).not.toThrow();
    expect(concurrent(0)).toThrow(/testing\.concurrency must be a positive integer, got 0/u);
    expect(concurrent(2.5)).toThrow(/positive integer/u);
    expect(concurrent(-1)).toThrow(/positive integer/u);
  });

  it("validates retries as a non-negative integer", () => {
    expect(withRetries(0)).not.toThrow();
    expect(withRetries(2)).not.toThrow();
    expect(withRetries(-1)).toThrow(/testing\.retries must be a non-negative integer, got -1/u);
    expect(withRetries(1.5)).toThrow(/non-negative integer/u);
  });

  it("validates leaseSeconds as a positive number", () => {
    expect(lease(300)).not.toThrow();
    expect(lease(0.5)).not.toThrow();
    expect(lease(0)).toThrow(/testing\.leaseSeconds must be a positive number of seconds, got 0/u);
    expect(lease(-1)).toThrow(/leaseSeconds/u);
    expect(lease(Number.NaN)).toThrow(/leaseSeconds/u);
  });

  it("validates maxJobSeconds as a positive number", () => {
    expect(maxJob(7200)).not.toThrow();
    expect(maxJob(0)).toThrow(
      /testing\.maxJobSeconds must be a positive number of seconds, got 0/u,
    );
    expect(maxJob(Number.NaN)).toThrow(/maxJobSeconds/u);
    // A timer past 2^31 - 1 ms fires after 1 ms in Node: refuse what it cannot hold.
    expect(maxJob(2_147_483)).not.toThrow();
    expect(maxJob(2_147_484)).toThrow(/at most 2147483 seconds/u);
  });

  it('requires workerEntry for mode "fork"', () => {
    expect(() => resolveShelfOptions({ ...base, testing: { runner, mode: "fork" } })).toThrow(
      /requires testing\.workerEntry/u,
    );
  });

  it("accepts a runner with a worker entry and any mode", () => {
    for (const mode of ["auto", "in-process", "fork"] as const) {
      expect(() =>
        resolveShelfOptions({ ...base, testing: { runner, workerEntry: "/app/w.ts", mode } }),
      ).not.toThrow();
    }
  });
});

describe("sequentialTransactionsWarning", () => {
  const sequential = {
    ...base,
    database: { metadata: { name: "Neon HTTP", category: "database", transactions: "sequential" } },
  } as unknown as ShelfOptions;

  it("warns when testing runs on a database with only sequential transactions", () => {
    expect(sequentialTransactionsWarning({ ...sequential, testing: { runner } })).toMatch(
      /Neon HTTP database runs transactions one statement at a time/u,
    );
  });

  it("is silent without testing, and for a database with real transactions", () => {
    expect(sequentialTransactionsWarning(sequential)).toBeUndefined();
    expect(sequentialTransactionsWarning({ ...base, testing: { runner } })).toBeUndefined();
    const atomic = {
      ...base,
      database: { metadata: { name: "Fake", category: "database", transactions: "atomic" } },
    } as unknown as ShelfOptions;
    expect(sequentialTransactionsWarning({ ...atomic, testing: { runner } })).toBeUndefined();
  });
});

/** An attempt to resolve options with `config`, as a function so a test can expect it to throw. */
const sub =
  (config: Record<string, unknown>, extra: Partial<ShelfOptions> = {}) =>
  (): void => {
    resolveShelfOptions({ ...base, ...extra, config } as unknown as ShelfOptions);
  };

describe("resolveShelfOptions storybook hosting", () => {
  const auth = {} as ShelfOptions["auth"];

  it("accepts the default and trusted mode, with or without sign-in or a secret", () => {
    expect(() => resolveShelfOptions({ ...base, auth })).not.toThrow();
    expect(hosted("trusted", { auth })).not.toThrow();
  });

  it("refuses sandboxed and subdomain with sign-in on and no secret", () => {
    expect(hosted("sandboxed", { auth })).toThrow(/needs config.secret/u);
    expect(hosted("subdomain", { auth })).toThrow(/needs config.secret/u);
  });

  it("accepts sandboxed, with a secret when sign-in is on and without one when it is off", () => {
    expect(hosted("sandboxed")).not.toThrow();
    expect(hosted("sandboxed", { auth, config: { secret: "s" } })).not.toThrow();
  });

  describe("subdomain", () => {
    const hosting = { mode: "subdomain", baseDomain: "shelf.example.com" };
    const ok = {
      secret: "s",
      publicBaseUrl: "https://shelf.example.com",
      storybookHosting: hosting,
    };
    const hostAuth = { hostSessionCookie: true } as ShelfOptions["auth"];

    it("accepts a configured https portal, with the __Host- cookie engine when sign-in is on", () => {
      expect(sub(ok)).not.toThrow();
      expect(sub(ok, { auth: hostAuth })).not.toThrow();
    });

    it("refuses a missing portal origin and a missing or malformed base domain", () => {
      expect(sub({ ...ok, publicBaseUrl: undefined })).toThrow(/needs config.publicBaseUrl/u);
      expect(sub({ ...ok, storybookHosting: { mode: "subdomain" } })).toThrow(
        /baseDomain is required/u,
      );
      expect(
        sub({ ...ok, storybookHosting: { mode: "subdomain", baseDomain: "*.x.com" } }),
      ).toThrow(/plain domain/u);
    });

    it("refuses an http portal except on a localhost name", () => {
      expect(sub({ ...ok, publicBaseUrl: "http://shelf.example.com" })).toThrow(/https/u);
      const local = {
        ...ok,
        publicBaseUrl: "http://localhost:3000",
        storybookHosting: { mode: "subdomain", baseDomain: "localhost" },
      };
      expect(sub(local)).not.toThrow();
      expect(sub({ ...local, publicBaseUrl: "ftp://localhost:3000" })).toThrow(/https/u);
      expect(sub({ ...local, publicBaseUrl: "http://app.localhost:3000" })).toThrow(
        /would also match the portal host/u,
      );
    });

    it("refuses a base domain that would also match the portal host", () => {
      expect(
        sub({ ...ok, storybookHosting: { mode: "subdomain", baseDomain: "example.com" } }),
      ).toThrow(/would also match the portal host/u);
    });

    it("refuses sign-in without the __Host- session cookie", () => {
      const plain = {} as ShelfOptions["auth"];
      expect(sub(ok, { auth: plain })).toThrow(/__Host- session cookie/u);
    });

    it("reads the deprecated publishedBaseDomain as the same mode, with the same rules", () => {
      const alias = {
        secret: "s",
        publicBaseUrl: "https://shelf.example.com",
        publishedBaseDomain: "shelf.example.com",
      };
      expect(sub(alias)).not.toThrow();
      expect(sub({ ...alias, publicBaseUrl: undefined })).toThrow(/needs config.publicBaseUrl/u);
      expect(sub({ ...alias, publishedBaseDomain: "bad domain" })).toThrow(/plain domain/u);
    });
  });

  it("validates the top-level storybookUrlRateLimit as a positive whole number", () => {
    expect(() => resolveShelfOptions({ ...base, storybookUrlRateLimit: 100 })).not.toThrow();
    expect(() => resolveShelfOptions({ ...base, storybookUrlRateLimit: 0 })).toThrow(
      /^storybookUrlRateLimit must be/u,
    );
  });
});
