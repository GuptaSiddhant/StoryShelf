import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { instanceDir } from "./__fixtures__/instance-dir.ts";
import { buildInstance, isShelfApp, loadInstance, resolveInstanceEntry } from "./instance.ts";

const APP = new URL("../index.tsx", import.meta.url).pathname;
const FIXTURE = new URL("__fixtures__/instance-app.ts", import.meta.url).pathname;

describe("instance entry", () => {
  it("falls back to the name search", async () => {
    const { dir } = instanceDir();
    expect(await resolveInstanceEntry(dir)).toBe(`${dir}/src/index.ts`);
  });

  it("prefers --entry, then package.json#storyshelf.server, over the name search", async () => {
    const { dir } = instanceDir();
    writeFileSync(join(dir, "other.ts"), "export {};\n");
    writeFileSync(join(dir, "third.ts"), "export {};\n");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ storyshelf: { server: "third.ts" } }),
    );
    expect(await resolveInstanceEntry(dir)).toBe(join(dir, "third.ts"));
    expect(await resolveInstanceEntry(dir, "other.ts")).toBe(join(dir, "other.ts"));
  });

  it("names a missing --entry or configured module, and a project with none", async () => {
    const { dir } = instanceDir();
    await expect(resolveInstanceEntry(dir, "nope.ts")).rejects.toThrow(/--entry/u);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ storyshelf: { server: "gone.ts" } }));
    await expect(resolveInstanceEntry(dir)).rejects.toThrow(/package\.json#storyshelf\.server/u);
    await expect(resolveInstanceEntry("/nonexistent-dir")).rejects.toThrow(/No instance module/u);
  });
});

describe("instance contract", () => {
  it("loads a definition and builds one app in the requested mode", async () => {
    const { dir } = instanceDir();
    const loaded = await loadInstance(dir);
    const built = await buildInstance(loaded, "tool", {});
    expect(built.app.lifecycle.mode).toBe("tool");
    await built.app.lifecycle.teardown();
  });

  it("refuses a module that exports a constructed app, naming defineShelfInstance", async () => {
    const source = `import { createShelfApp } from ${JSON.stringify(APP)};
import { fixtureOptions } from ${JSON.stringify(FIXTURE)};
export default createShelfApp(fixtureOptions("/tmp"), { mode: "tool" });
`;
    await expect(loadInstance(instanceDir({ source }).dir)).rejects.toThrow(/defineShelfInstance/u);
  });

  it("refuses a module that builds an app while loading, even without exporting it", async () => {
    const source = `import { createShelfApp, defineShelfInstance } from ${JSON.stringify(APP)};
import { fixtureOptions } from ${JSON.stringify(FIXTURE)};
createShelfApp(fixtureOptions("/tmp"), { mode: "tool" });
export default defineShelfInstance(async () => fixtureOptions("/tmp"));
`;
    await expect(loadInstance(instanceDir({ source }).dir)).rejects.toThrow(
      /constructed an app while loading/u,
    );
  });

  it("refuses a factory that builds an app of its own", async () => {
    const source = `import { createShelfApp, defineShelfInstance } from ${JSON.stringify(APP)};
import { fixtureOptions } from ${JSON.stringify(FIXTURE)};
export default defineShelfInstance(async () => {
  const options = fixtureOptions("/tmp");
  createShelfApp(options, { mode: "tool" });
  return options;
});
`;
    const loaded = await loadInstance(instanceDir({ source }).dir);
    await expect(buildInstance(loaded, "tool", {})).rejects.toThrow(/besides the bin's/u);
  });

  it("refuses a module with no definition", async () => {
    await expect(
      loadInstance(instanceDir({ source: "export const x = 1;\n" }).dir),
    ).rejects.toThrow(/no instance definition/u);
  });

  it("recognises only app-shaped values", () => {
    expect(isShelfApp(null)).toBe(false);
    expect(isShelfApp({ fetch: () => 1 })).toBe(false);
  });

  it("creates the --entry module relative to --dir", async () => {
    const { dir } = instanceDir();
    mkdirSync(join(dir, "app"));
    writeFileSync(join(dir, "app/server.ts"), "export const x = 1;\n");
    await expect(loadInstance(dir, "app/server.ts")).rejects.toThrow(/no instance definition/u);
  });
});
