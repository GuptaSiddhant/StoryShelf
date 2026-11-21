import { describe, expect, it } from "vitest";
import { instanceDir } from "./__fixtures__/instance-dir.ts";
import { isShelfApp, loadInstance, resolveInstanceEntry } from "./instance.ts";

describe("instance loading", () => {
  it("finds the entry and takes the default export", async () => {
    const dir = instanceDir();
    expect(await resolveInstanceEntry(dir)).toBe(`${dir}/src/index.ts`);
    const { app } = await loadInstance(dir);
    expect(isShelfApp(app)).toBe(true);
  });

  it("also takes a named `app` export", async () => {
    const dir = instanceDir(
      `import { createFixtureApp } from ${JSON.stringify(new URL("__fixtures__/instance-app.ts", import.meta.url).pathname)};\nexport const app = createFixtureApp();\n`,
    );
    expect(isShelfApp((await loadInstance(dir)).app)).toBe(true);
  });

  it("names the problem when there is no entry or no app", async () => {
    await expect(loadInstance("/nonexistent-dir")).rejects.toThrow(/No instance module/u);
    await expect(loadInstance(instanceDir("export const x = 1;\n"))).rejects.toThrow(
      /does not export the app/u,
    );
  });

  it("recognises only app-shaped values", () => {
    expect(isShelfApp(null)).toBe(false);
    expect(isShelfApp({ fetch: () => 1 })).toBe(false);
  });
});
