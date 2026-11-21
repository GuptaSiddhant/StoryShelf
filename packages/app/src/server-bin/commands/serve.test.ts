import { describe, expect, it, vi } from "vitest";
import { instanceDir, recordingIo } from "../__fixtures__/instance-dir.ts";
import { serve } from "./serve.ts";

describe("serve", () => {
  it("listens, answers, and exits 0 after SIGTERM", async () => {
    const io = recordingIo();
    const done = serve({ dir: instanceDir(), port: 0 }, io, {});
    await vi.waitFor(() => expect(io.stdout).toHaveLength(1), { timeout: 10_000 });
    const url = /listening on (?<url>\S+)/u.exec(io.stdout[0] ?? "")?.groups?.["url"];
    expect(url).toBeDefined();
    expect((await fetch(`${url}/api/v1/health`)).ok).toBe(true);
    process.emit("SIGTERM");
    expect(await done).toBe(0);
  });
});
