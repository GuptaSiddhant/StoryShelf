import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const hooks = pathToFileURL(join(import.meta.dirname, "readiness.hooks.ts")).href;
const child = join(import.meta.dirname, "readiness.child.ts");

/** Boot an app with `testing` in a fresh Node with `blocked` unresolvable; returns its readiness. */
function boot(blocked: string[]): string {
  const register = `data:text/javascript,${encodeURIComponent(`import { register } from "node:module"; register(${JSON.stringify(hooks)});`)}`;
  // `nub` runs the TS and TSX source (node alone cannot load the app's `.tsx`).
  const result = spawnSync("nub", ["--conditions=source", "--import", register, child], {
    cwd: join(import.meta.dirname, "../.."),
    encoding: "utf8",
    env: { ...process.env, SHELF_BLOCKED_PEERS: blocked.join(",") },
  });
  const line = result.stdout.split("\n").find((l) => l.startsWith("REPORT "));
  if (line === undefined) {
    throw new Error(`no report (exit ${result.status}): ${result.stderr}`);
  }
  return String((JSON.parse(line.slice("REPORT ".length)) as { setup: unknown }).setup);
}

// Each case boots a whole app in a fresh Node process, which is slow under load.
const BOOT_TIMEOUT_MS = 60_000;

/**
 * The image libraries are this package's (#1365): with `testing` on, the app checks the runner's
 * engine at readiness, which fails naming a missing library and the install line.
 */
describe("image engine readiness in a testing app", { timeout: BOOT_TIMEOUT_MS }, () => {
  it("passes with the libraries present", () => {
    expect(boot([])).toBe("ok");
  });

  it.each(["pngjs", "pixelmatch"])(
    "fails naming %s and the install line when it is missing",
    (peer) => {
      const setup = boot([peer]);
      expect(setup).toContain(`\`${peer}\``);
      expect(setup).toContain("nub add pngjs pixelmatch");
    },
  );
});
