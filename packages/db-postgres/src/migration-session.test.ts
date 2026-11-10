import { describe, expect, it } from "vite-plus/test";
import { pooledSession, singleSession } from "./migration-session.ts";

describe("migration sessions", () => {
  it("pooledSession runs on one checked-out connection and releases it, even on failure", async () => {
    const calls: string[] = [];
    const connection = {
      query: async (sql: string) => {
        calls.push(sql);
        return { rows: [{ sql }] };
      },
      release: () => calls.push("release"),
    };
    const session = pooledSession({ connect: async () => connection });
    await expect(session(async (run) => await run("a"))).resolves.toEqual([{ sql: "a" }]);
    await expect(
      session(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(calls).toEqual(["a", "release", "release"]);
  });

  it("singleSession queries the injected connection", async () => {
    const session = singleSession({ query: async () => ({ rows: [1] }) });
    await expect(session(async (run) => await run("x"))).resolves.toEqual([1]);
  });
});
