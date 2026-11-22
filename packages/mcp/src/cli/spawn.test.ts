import { describe, expect, it } from "vitest";
import { defaultSpawnProcess } from "./spawn.ts";

const run = async (code: number): Promise<number> =>
  await defaultSpawnProcess(process.execPath, ["-e", `process.exit(${code})`], {
    cwd: process.cwd(),
    env: process.env,
  });

describe("defaultSpawnProcess", () => {
  it("resolves the exit code of the child", async () => {
    expect(await run(0)).toBe(0);
    expect(await run(3)).toBe(3);
  });
});
