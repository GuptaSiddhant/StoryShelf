import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/** Libraries only a testing deployment may load; `@storyshelf/runner` brings them (ADR 0049, #1335). */
const TESTING_ONLY = ["pngjs", "pixelmatch", "axe-core"];

const hooks = pathToFileURL(join(import.meta.dirname, "peer-isolation.hooks.ts")).href;
const child = join(import.meta.dirname, "peer-isolation.child.ts");

/** Boot the app in a fresh Node with `blocked` unresolvable; returns the child's JSON report. */
function boot(mode: "hosting" | "testing", blocked: string[]): Record<string, unknown> {
  const register = `data:text/javascript,${encodeURIComponent(`import { register } from "node:module"; register(${JSON.stringify(hooks)});`)}`;
  // `nub` runs the TS and TSX source (node alone cannot load `.tsx`).
  const result = spawnSync("nub", ["--conditions=source", "--import", register, child, mode], {
    cwd: join(import.meta.dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, SHELF_BLOCKED_PEERS: blocked.join(",") },
  });
  const line = result.stdout.split("\n").find((l) => l.startsWith("REPORT "));
  if (line === undefined) {
    throw new Error(`no report (exit ${result.status}): ${result.stderr}`);
  }
  return JSON.parse(line.slice("REPORT ".length)) as Record<string, unknown>;
}

// Each case boots a whole app in a fresh Node process, which is slow under load.
const BOOT_TIMEOUT_MS = 60_000;

describe(
  "testing-only libraries stay out of a hosting-only deployment",
  { timeout: BOOT_TIMEOUT_MS },
  () => {
    it("boots, serves health and publishes a Storybook with pngjs, pixelmatch and axe-core unresolvable", () => {
      expect(boot("hosting", TESTING_ONLY)).toEqual({ setup: "ok", health: 200, upload: 202 });
    });

    it("with testing on and the peers present, readiness passes", () => {
      expect(boot("testing", [])).toMatchObject({ setup: "ok", health: 200 });
    });

    it.each(["pngjs", "pixelmatch"])(
      "with testing on and %s missing, readiness fails naming it and the install line",
      (peer) => {
        const report = boot("testing", [peer]);
        expect(String(report["setup"])).toContain(`\`${peer}\``);
        expect(String(report["setup"])).toContain("nub add pngjs pixelmatch");
      },
    );
  },
);
