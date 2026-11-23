import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Libraries only a testing deployment may load; `@storyshelf/runner` owns them (ADR 0049, #1335,
 * #1365). Its `images/readiness.test.ts` covers a testing boot whose image engine cannot load.
 */
const TESTING_ONLY = ["pngjs", "pixelmatch", "axe-core"];

const hooks = pathToFileURL(join(import.meta.dirname, "peer-isolation.hooks.ts")).href;
const child = join(import.meta.dirname, "peer-isolation.child.ts");

/** Boot a hosting-only app in a fresh Node with `blocked` unresolvable; returns the child's JSON report. */
function boot(blocked: string[]): Record<string, unknown> {
  const register = `data:text/javascript,${encodeURIComponent(`import { register } from "node:module"; register(${JSON.stringify(hooks)});`)}`;
  // `nub` runs the TS and TSX source (node alone cannot load `.tsx`).
  const result = spawnSync("nub", ["--conditions=source", "--import", register, child], {
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
      expect(boot(TESTING_ONLY)).toMatchObject({
        setup: "ok",
        health: 200,
        upload: 202,
      });
    });

    it("starts its job consumers, publishes a queued zip and runs a notify job without the image peers", () => {
      expect(boot([...TESTING_ONLY, "sharp"])).toMatchObject({
        published: true,
        notified: true,
        errors: [],
      });
    });
  },
);
