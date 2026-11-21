import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { afterSetupMarker, instanceDir, recordingIo } from "../__fixtures__/instance-dir.ts";
import { runServerBin } from "../main.ts";
import { serve } from "./serve.ts";
import { watchArgs, watchServe } from "./watch.ts";

describe("serve", () => {
  it("runs afterSetup, listens, answers, and exits 0 after SIGTERM", async () => {
    const { dir, dataDir } = instanceDir({ afterSetup: true });
    const io = recordingIo();
    const done = serve({ flags: { dir, port: 0 }, io, env: {} });
    await vi.waitFor(() => expect(io.stdout).toHaveLength(1), { timeout: 10_000 });
    const url = /listening on (?<url>\S+)/u.exec(io.stdout[0] ?? "")?.groups?.["url"];
    expect(url).toBeDefined();
    expect((await fetch(`${url}/api/v1/health`)).ok).toBe(true);
    // The hook ran after setup and before the port opened.
    expect(existsSync(afterSetupMarker(dataDir))).toBe(true);
    process.emit("SIGTERM");
    expect(await done).toBe(0);
  });

  it("only serve runs afterSetup: migrate, doctor and the tools never do", async () => {
    const { dir, dataDir } = instanceDir({ afterSetup: true });
    await runServerBin(["migrate", "--dir", dir], recordingIo(), {});
    await runServerBin(["doctor", "--dir", dir], recordingIo(), {});
    await runServerBin(["purge", "--dir", dir], recordingIo(), {});
    await runServerBin(["check-storage", "--dir", dir], recordingIo(), {});
    expect(existsSync(afterSetupMarker(dataDir))).toBe(false);
  });
});

describe("serve --watch", () => {
  it("runs this bin under node --watch with serve and the flags, without --watch", async () => {
    expect(watchArgs("/x/bin.mjs", { dir: "d", entry: "e.ts", port: 9, watch: true })).toEqual([
      "--watch",
      "/x/bin.mjs",
      "serve",
      "--dir",
      "d",
      "--entry",
      "e.ts",
      "--port",
      "9",
    ]);
    const spawnWatch = vi.fn(async () => await Promise.resolve(3));
    expect(await watchServe({ watch: true }, spawnWatch, "/x/bin.mjs")).toBe(3);
    expect(spawnWatch).toHaveBeenCalledWith(["--watch", "/x/bin.mjs", "serve"]);
  });

  it("is what `serve --watch` runs, loading no instance", async () => {
    const spawnWatch = vi.fn(async () => await Promise.resolve(0));
    const code = await serve(
      { flags: { dir: "/nonexistent-dir", watch: true }, io: recordingIo(), env: {} },
      { spawnWatch },
    );
    expect(code).toBe(0);
    expect(spawnWatch).toHaveBeenCalledOnce();
  });
});
