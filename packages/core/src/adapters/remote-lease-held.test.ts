import { describe, expect, it, vi } from "vitest";
import { defineRemote, remoteTargetsOf, type RemoteOptions } from "./remote-browser.ts";
import { holdLease, noLease, releaseAllHeld, withDeadline } from "./remote-lease-held.ts";

const SUPPORT = { engines: ["chromium"], protocols: ["playwright"], label: "remote()" } as const;

function entryOf(overrides: Partial<RemoteOptions<string>> = {}) {
  const remote = defineRemote<string>(
    {
      name: "held",
      engines: ["chromium"],
      sessions: 1,
      protocol: "playwright",
      reach: "url",
      connect: async () => await Promise.resolve({ endpoint: "ws://127.0.0.1:1/" }),
      ...overrides,
    },
    SUPPORT,
  );
  return remoteTargetsOf(remote)[0] as ReturnType<typeof remoteTargetsOf>[number];
}

const connection = { endpoint: "ws://127.0.0.1:1/" };

describe("holdLease", () => {
  it("calls release once with the outcome and error, and ignores later calls", async () => {
    const release = vi.fn();
    const held = holdLease(entryOf({ release }), "lease-1", connection);
    expect(held.connection).toEqual({ ...connection, lease: "lease-1" });
    await held.end("failed", new Error("x"));
    await held.end("finished");
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith("lease-1", {
      outcome: "failed",
      error: expect.any(Error),
    });
  });

  it("skips release without a lease, warning once per target", async () => {
    const warn = vi.fn();
    const release = vi.fn();
    const entry = entryOf({ name: "nolease-held", release });
    for (let index = 0; index < 2; index += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential
      await holdLease(entry, undefined, connection, { warn } as never).end("finished");
    }
    expect(release).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn when there is no release to skip", () => {
    const warn = vi.fn();
    holdLease(entryOf({ name: "norelease-held" }), undefined, connection, { warn } as never);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs a throwing or hanging release by class only", async () => {
    const warn = vi.fn();
    const throwing = holdLease(
      entryOf({
        release: () => {
          throw new TypeError("secret-text");
        },
      }),
      "l",
      connection,
      { warn } as never,
    );
    await throwing.end("finished");
    const hanging = holdLease(
      entryOf({
        release: async () => await new Promise<void>(() => {}),
        timeouts: { releaseMs: 5 },
      }),
      "l",
      connection,
      { warn } as never,
    );
    await hanging.end("cancelled");
    expect(warn.mock.calls.map((call) => (call[0] as { err: string }).err)).toEqual([
      "TypeError",
      "ReleaseTimeout",
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-text");
  });
});

describe("releaseAllHeld", () => {
  it("releases every lease still held as cancelled, once", async () => {
    const release = vi.fn();
    holdLease(entryOf({ release }), "a", connection);
    holdLease(entryOf({ release }), "b", connection);
    await releaseAllHeld();
    await releaseAllHeld();
    expect(release.mock.calls.map((call) => [call[0], call[1].outcome])).toEqual([
      ["a", "cancelled"],
      ["b", "cancelled"],
    ]);
  });
});

describe("noLease and withDeadline", () => {
  it("noLease ends without doing anything", async () => {
    await expect(noLease(connection).end("finished")).resolves.toBeUndefined();
  });

  it("withDeadline returns the value, or the error the deadline makes", async () => {
    await expect(withDeadline(Promise.resolve(3), 50, () => new Error("late"))).resolves.toBe(3);
    await expect(
      withDeadline(new Promise<number>(() => {}), 5, () => new Error("late")),
    ).rejects.toThrow("late");
  });
});
