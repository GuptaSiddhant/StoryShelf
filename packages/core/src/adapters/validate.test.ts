import { describe, expect, it } from "vitest";
import { validateAdapter, validateAdapterSources, validateAuth } from "./validate.ts";

function storage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    metadata: { name: "Local", version: "1.0.0", kind: "local", category: "storage" },
    read: async () => Buffer.from(""),
    write: async () => {},
    delete: async () => {},
    exists: async () => true,
    list: async () => [],
    writeStream: async () => {},
    readStream: async () => null,
    ...overrides,
  };
}

function database(): Record<string, unknown> {
  const tables: Record<string, unknown> = {};
  for (const table of [
    "projects",
    "builds",
    "snapshots",
    "baselines",
    "comments",
    "labelTypes",
    "buildLabels",
    "tokens",
    "webhooks",
    "users",
    "projectMembers",
  ]) {
    tables[table] = {};
  }
  return {
    metadata: { name: "SQLite", version: "1.0.0", kind: "sqlite", category: "database" },
    tables,
    insert: async () => ({}),
    update: async () => ({}),
    get: async () => null,
    remove: async () => {},
    list: async () => [],
    count: async () => 0,
    all: async () => [],
  };
}

function queue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    metadata: { name: "Q", version: "1.0.0", kind: "memory", category: "capture-queue" },
    enqueue: async () => {},
    status: async () => null,
    active: async () => [],
    recent: async () => [],
    ...overrides,
  };
}

describe("validateAdapter", () => {
  it("accepts a sound storage adapter", () => {
    expect(validateAdapter(storage(), "storage", "storage")).toEqual([]);
  });

  it("rejects a non-object adapter", () => {
    expect(validateAdapter(null, "storage", "storage")).toEqual([
      "storage adapter must be an object",
    ]);
  });

  it("rejects wrong-category metadata", () => {
    const bad = storage({
      metadata: { name: "X", version: "1.0.0", kind: "x", category: "database" },
    });
    expect(validateAdapter(bad, "storage", "storage").join(";")).toContain("does not match slot");
  });

  it("rejects empty metadata fields", () => {
    const bad = storage({ metadata: { name: "", version: "", kind: "", category: "" } });
    expect(validateAdapter(bad, "storage", "storage").length).toBeGreaterThan(0);
  });

  it("rejects partial lifecycle", () => {
    const bad = storage({ lifecycle: { setup: async () => {} } });
    expect(validateAdapter(bad, "storage", "storage").join(";")).toContain("partial lifecycle");
  });

  it("accepts a full lifecycle", () => {
    const full = storage({
      lifecycle: { setup: async () => {}, teardown: async () => {}, health: async () => ({}) },
    });
    expect(validateAdapter(full, "storage", "storage")).toEqual([]);
  });

  it("rejects missing methods", () => {
    const bad = storage({ read: undefined });
    expect(validateAdapter(bad, "storage", "storage").join(";")).toContain("missing methods: read");
  });

  it("rejects a database missing tables", () => {
    const bad = database();
    bad.tables = { projects: {} };
    expect(validateAdapter(bad, "database", "database").join(";")).toContain("missing tables");
  });

  it("rejects a partial poll extension", () => {
    const bad = queue({ poll: async () => null });
    expect(validateAdapter(bad, "capture-queue", "captureQueue").join(";")).toContain(
      "partial poll extension",
    );
  });

  it("accepts a full poll extension", () => {
    const full = queue({ poll: async () => null, ack: async () => {}, nack: async () => {} });
    expect(validateAdapter(full, "capture-queue", "captureQueue")).toEqual([]);
  });
});

describe("validateAdapterSources", () => {
  it("accepts a sound assembly", () => {
    const failures = validateAdapterSources({
      database: database() as never,
      storage: storage() as never,
    });
    expect(failures).toEqual([]);
  });

  it("reports per-adapter failures with identity", () => {
    const failures = validateAdapterSources({
      database: database() as never,
      storage: { metadata: { name: "", version: "", kind: "", category: "" } } as never,
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.category).toBe("storage");
    expect(failures[0]?.error.length).toBeGreaterThan(0);
  });

  it("validates git providers including schema", () => {
    const failures = validateAdapterSources({
      database: database() as never,
      storage: storage() as never,
      gitHosts: [
        { metadata: { name: "GH", version: "1", kind: "gh", category: "git-host" } } as never,
      ],
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.category).toBe("git-host");
  });

  it("validates notifier providers and email senders", () => {
    const failures = validateAdapterSources({
      database: database() as never,
      storage: storage() as never,
      notifiers: [
        { metadata: { name: "N", version: "1", kind: "n", category: "notifier" } } as never,
      ],
      emailSender: {
        metadata: { name: "S", version: "1", kind: "s", category: "notifier" },
      } as never,
    });
    expect(failures).toHaveLength(2);
    expect(failures.map((failure) => failure.category)).toEqual(["notifier", "notifier"]);
  });
});

function engine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    handler: () => new Response(),
    loginMethods: () => [{ kind: "password", id: "local", label: "Local" }],
    setup: async () => {},
    issueInvite: async () => ({}),
    verifyInvite: async () => ({}),
    acceptInvite: async () => ({}),
    passkeysEnabled: () => false,
    listSessions: async () => [],
    listPasskeys: async () => [],
    hasPassword: async () => false,
    setDisabled: async () => {},
    check: async () => null,
    createSession: async () => "",
    destroySession: async () => {},
    ...overrides,
  };
}

describe("validateAuth", () => {
  it("accepts missing auth (it is optional)", () => {
    expect(validateAuth()).toEqual([]);
  });

  it("accepts a sound engine", () => {
    expect(validateAuth(engine())).toEqual([]);
  });

  it("rejects missing methods", () => {
    expect(validateAuth(engine({ check: "nope" })).join(";")).toContain("missing methods: check");
  });

  it("rejects duplicate login method ids", () => {
    const dup = engine({
      loginMethods: () => [
        { kind: "oauth", id: "sso", label: "A" },
        { kind: "oauth", id: "sso", label: "B" },
      ],
    });
    expect(validateAuth(dup).join(";")).toContain("duplicate login method ids");
  });

  it("reports loginMethods() throws", () => {
    const broken = engine({
      loginMethods: () => {
        throw new Error("engine down");
      },
    });
    expect(validateAuth(broken).join(";")).toContain("loginMethods() threw");
  });
});
