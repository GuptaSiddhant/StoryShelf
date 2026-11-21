import { describe, expect, it, vi } from "vitest";
import { collectHealthReport } from "./health-report.ts";

function sources(): Parameters<typeof collectHealthReport>[0] {
  const storage = {
    metadata: { name: "Local", version: "0.0.0", kind: "local", category: "storage" },
  };
  const database = {
    metadata: { name: "SQLite", version: "0.0.0", kind: "sqlite", category: "database" },
  };
  return { database, storage } as never;
}

describe("collectHealthReport", () => {
  it("redacts secrets in setup failure details", async () => {
    const report = await collectHealthReport(
      sources(),
      {
        ok: false,
        failures: [
          {
            category: "storage",
            kind: "local",
            name: "Local",
            error: "connect postgres://user:s3cret@host/db failed",
          },
        ],
      },
      Date.now(),
      "0.0.0",
    );
    const entry = report.adapters.find((adapter) => adapter.kind === "local");
    expect(entry?.state).toBe("failed");
    expect(entry?.detail).not.toContain("s3cret");
    expect(entry?.detail).toContain("[redacted]");
    expect(report.status).toBe("degraded");
  });

  describe("setup failures of adapters it does not probe", () => {
    const ai = {
      category: "ai",
      kind: "vercel-ai",
      name: "AI",
      error: "model spec v4 is not supported; key sk-ant-api03-SECRETSECRETSECRET",
    };

    it("reports a failed AI setup as its own failed entry and degrades the status", async () => {
      const report = await collectHealthReport(
        sources(),
        { ok: false, failures: [ai] },
        Date.now(),
        "0.0.0",
      );
      const entry = report.adapters.find((adapter) => adapter.category === "ai");
      expect(entry).toMatchObject({
        category: "ai",
        kind: "vercel-ai",
        name: "AI",
        state: "failed",
        hasLifecycle: false,
      });
      expect(entry?.detail).toContain("model spec v4");
      // The provider key in the error text is redacted, not served to the site admin.
      expect(entry?.detail).not.toContain("SECRETSECRETSECRET");
      expect(entry?.detail).toContain("[redacted]");
      expect(report.status).toBe("degraded");
    });

    it("sanitizes the detail", async () => {
      const report = await collectHealthReport(
        sources(),
        {
          ok: false,
          failures: [{ ...ai, error: "connect postgres://user:s3cret@host/db failed" }],
        },
        Date.now(),
        "0.0.0",
      );
      const entry = report.adapters.find((adapter) => adapter.category === "ai");
      expect(entry?.detail).not.toContain("s3cret");
      expect(entry?.detail).toContain("[redacted]");
    });

    it("adds one entry for an adapter whose setup failed in several hooks", async () => {
      const report = await collectHealthReport(
        sources(),
        { ok: false, failures: [ai, { ...ai, error: "second hook failed" }] },
        Date.now(),
        "0.0.0",
      );
      expect(report.adapters.filter((adapter) => adapter.category === "ai")).toHaveLength(1);
    });

    it("keeps two adapters that share a category and kind apart by name", async () => {
      const report = await collectHealthReport(
        sources(),
        {
          ok: false,
          failures: [
            { category: "notifier", kind: "unknown", name: "notifiers[0]", error: "no kind" },
            {
              category: "notifier",
              kind: "unknown",
              name: "notifiers[1]",
              error: "no kind either",
            },
          ],
        },
        Date.now(),
        "0.0.0",
      );
      expect(
        report.adapters.filter((adapter) => adapter.kind === "unknown").map((a) => a.name),
      ).toEqual(["notifiers[0]", "notifiers[1]"]);
    });

    it("adds nothing for a successful setup, and nothing twice for a probed adapter", async () => {
      const ok = await collectHealthReport(
        sources(),
        { ok: true, failures: [] },
        Date.now(),
        "0.0.0",
      );
      const probed = await collectHealthReport(
        sources(),
        {
          ok: false,
          failures: [{ category: "storage", kind: "local", name: "Local", error: "no space" }],
        },
        Date.now(),
        "0.0.0",
      );
      expect(ok.adapters.map((adapter) => adapter.category)).toEqual(["database", "storage"]);
      expect(ok.status).toBe("ok");
      expect(probed.adapters).toHaveLength(2);
    });

    it("adds nothing while setup is still running", async () => {
      const report = await collectHealthReport(sources(), null, Date.now(), "0.0.0");
      expect(report.adapters).toHaveLength(2);
      expect(report.status).toBe("starting");
    });
  });
});

const failingAiHealth = async (): Promise<{ ok: boolean; detail: string }> => ({
  ok: false,
  detail: "bad key sk-ant-api03-SECRETSECRETSECRET",
});

describe("dependency probes", () => {
  it("probes the AI adapter through its free health() and reports it as ai/ai", async () => {
    const health = vi.fn(async () => ({ ok: true as const }));
    const report = await collectHealthReport(
      { ...sources(), ai: { health } as never },
      { ok: true, failures: [] },
      Date.now(),
      "0.0.0",
    );
    expect(health).toHaveBeenCalledOnce();
    expect(report.adapters.find((a) => a.category === "ai")).toMatchObject({
      kind: "ai",
      state: "ok",
      hasLifecycle: true,
    });
  });

  it("reports a failing AI health, with the key redacted, and degrades the status", async () => {
    const report = await collectHealthReport(
      { ...sources(), ai: { health: failingAiHealth } as never },
      { ok: true, failures: [] },
      Date.now(),
      "0.0.0",
    );
    const entry = report.adapters.find((a) => a.category === "ai");
    expect(entry?.state).toBe("failed");
    expect(entry?.detail).not.toContain("SECRETSECRET");
    expect(report.status).toBe("degraded");
  });

  it("puts a failed AI setup on the probed row, not a second one", async () => {
    const report = await collectHealthReport(
      { ...sources(), ai: { health: async () => ({ ok: true }) } as never },
      {
        ok: false,
        failures: [{ category: "ai", kind: "ai", name: "ai", error: "spec v9 unsupported" }],
      },
      Date.now(),
      "0.0.0",
    );
    expect(report.adapters.filter((a) => a.category === "ai")).toHaveLength(1);
    expect(report.adapters.find((a) => a.category === "ai")?.state).toBe("failed");
  });

  it("probes each OIDC provider and times out one that hangs", async () => {
    vi.useFakeTimers();
    try {
      const pending = collectHealthReport(
        {
          ...sources(),
          authProviders: [
            { id: "kc", label: "Keycloak", check: async () => ({ ok: true, detail: "reachable" }) },
            { id: "slow", label: "Slow IdP", check: () => new Promise(() => {}) },
          ],
        },
        { ok: true, failures: [] },
        Date.now(),
        "0.0.0",
      );
      await vi.advanceTimersByTimeAsync(2500);
      const report = await pending;
      const oidc = report.adapters.filter((a) => a.kind === "oidc");
      expect(oidc.map((a) => [a.name, a.state])).toEqual([
        ["Keycloak", "ok"],
        ["Slow IdP", "failed"],
      ]);
      expect(oidc[1]?.detail).toContain("timed out");
    } finally {
      vi.useRealTimers();
    }
  });

  it("adds no AI or auth row when neither is wired, and carries the status rows through", async () => {
    const statuses = [{ id: "telemetry", label: "T", value: "off", tone: "off" }] as const;
    const report = await collectHealthReport(
      sources(),
      { ok: true, failures: [] },
      Date.now(),
      "0.0.0",
      null,
      statuses,
    );
    expect(report.adapters.map((a) => a.category)).toEqual(["database", "storage"]);
    expect(report.statuses).toEqual(statuses);
  });
});
