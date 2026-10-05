import { describe, expect, it } from "vitest";
import { createGcsStorage } from "./index.ts";

function makeGcsClient(): { client: unknown; calls: string[] } {
  const calls: string[] = [];

  const bucket = {
    getFiles: async (opts?: unknown): Promise<[never[]]> => {
      calls.push(`getFiles:${JSON.stringify(opts ?? null)}`);
      return [[]];
    },
  };

  return { client: { bucket: (): unknown => bucket }, calls };
}

describe("createGcsStorage - lifecycle", () => {
  it("setup and health probe the bucket", async () => {
    const { client, calls } = makeGcsClient();
    const storage = createGcsStorage({ bucket: "bkt", prefix: "app", client: client as never });

    await storage.lifecycle?.setup({} as never);
    await storage.lifecycle?.health();

    expect(calls).toContain('getFiles:{"prefix":"app/","maxResults":1}');
  });

  it("health probes with no prefix when none is configured", async () => {
    const { client, calls } = makeGcsClient();
    const storage = createGcsStorage({ bucket: "bkt", client: client as never });

    await storage.lifecycle?.health();

    expect(calls).toContain('getFiles:{"maxResults":1}');
  });

  it("health reports ok", async () => {
    const { client } = makeGcsClient();
    const storage = createGcsStorage({ bucket: "bkt", client: client as never });

    await expect(storage.lifecycle?.health()).resolves.toEqual({ ok: true });
  });

  it("teardown is a no-op", async () => {
    const { client, calls } = makeGcsClient();
    const storage = createGcsStorage({ bucket: "bkt", client: client as never });

    await expect(storage.lifecycle?.teardown()).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });
});
