import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  Browser,
  chromium as Chromium,
} from "../../runner-playwright/node_modules/playwright-core/index.js";

/**
 * Loads the built addon in the built Storybook of each fixture (ADR 0042, decision 4): 8.6, 9 and
 * 10, which name the manager API differently. Gated (`RUN_INTEGRATION=1`); needs each fixture's
 * `pnpm install` and a Chromium (`npx playwright install chromium`).
 */

const root = fileURLToPath(new URL("../../..", import.meta.url));
// Playwright is `runner-playwright`'s dependency; this package declares none of its own.
const { chromium } = createRequire(join(root, "packages/runner-playwright/package.json"))(
  "playwright-core",
) as { chromium: typeof Chromium };
const presetFile = join(root, "packages/storybook-addon/dist/preset.mjs");
const BASE = "/projects/gate/storybook/build/b1";
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

/** The fixture's own `.storybook` copied beside it with the addon added, so its framework still resolves. */
function buildWithAddon(version: string): string {
  const fixture = join(root, "fixtures", `storybook-${version}`);
  const config = join(fixture, ".storybook-addon");
  const out = join(root, ".tmp", `addon-storybook-${version}`);
  rmSync(config, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
  cpSync(join(fixture, ".storybook"), config, { recursive: true });
  const main = readFileSync(join(config, "main.ts"), "utf8").replace(
    "addons: [",
    `addons: [${JSON.stringify(presetFile)}, `,
  );
  writeFileSync(join(config, "main.ts"), main);
  execFileSync("pnpm", ["exec", "storybook", "build", "-c", ".storybook-addon", "-o", out], {
    cwd: fixture,
    stdio: "pipe",
  });
  rmSync(config, { recursive: true, force: true });
  return out;
}

function firstStoryId(dir: string): string {
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as {
    entries: Record<string, { type: string; id: string }>;
  };
  const story = Object.values(index.entries).find((entry) => entry.type === "story");
  if (!story) throw new Error("fixture has no story");
  return story.id;
}

interface Served {
  server: Server;
  port: number;
  requests: string[];
}

/** Serves a build at the published path, with a stubbed health and story-status. */
async function serve(dir: string, storyId: string): Promise<Served> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x");
    requests.push(url.pathname);
    const json = (value: unknown): void => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(value));
    };
    if (url.pathname === "/api/v1/health") return json({ testing: true });
    if (url.pathname === "/api/v1/projects/gate/builds/b1/story-status") {
      return json({
        build: { status: "reviewing", reviewPath: "/projects/gate/builds/b1/diff" },
        stories: { [storyId]: { status: "changed", design: "stale" } },
      });
    }
    if (url.pathname === "/projects/gate/builds/b1/diff") return response.end("review");
    const prefix = url.pathname.startsWith(BASE) ? BASE : "";
    const relative = normalize(url.pathname.slice(prefix.length)).replace(/^(?:[\\/]|\.\.)+/u, "");
    const file = join(
      dir,
      relative === "" || relative.endsWith("/") ? `${relative}index.html` : relative,
    );
    if (!existsSync(file)) return response.writeHead(404).end();
    response.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
    return response.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, port: typeof address === "object" && address ? address.port : 0, requests };
}

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")("addon in the fixture Storybooks", () => {
  let browser: Browser;
  beforeAll(async () => {
    mkdirSync(join(root, ".tmp"), { recursive: true });
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => {
    await browser.close();
  });

  it.each(["8", "9", "10"])(
    "shows badges that link to the review in Storybook %s, and nothing off a published build",
    async (version) => {
      const dir = buildWithAddon(version);
      const storyId = firstStoryId(dir);
      const published = await serve(dir, storyId);
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${published.port}${BASE}/?path=/story/${storyId}`);
      const item = page.locator(`[data-item-id="${storyId}"]`).first();
      await expect
        .poll(async () => await item.textContent(), { timeout: 30_000 })
        .toContain("Changed");
      expect(await item.textContent()).toContain("Design stale");
      const popup = page.waitForEvent("popup");
      await item.getByText("Changed").click();
      expect((await popup).url()).toBe(
        `http://127.0.0.1:${published.port}/projects/gate/builds/b1/diff`,
      );
      await page.close();
      published.server.close();

      const local = await serve(dir, storyId);
      const plain = await browser.newPage();
      await plain.goto(`http://127.0.0.1:${local.port}/?path=/story/${storyId}`);
      await plain.locator(`[data-item-id="${storyId}"]`).first().waitFor({ timeout: 30_000 });
      expect(local.requests.some((path) => path.startsWith("/api/"))).toBe(false);
      expect(
        await plain.locator(`[data-item-id="${storyId}"]`).first().textContent(),
      ).not.toContain("Changed");
      await plain.close();
      local.server.close();
    },
    180_000,
  );
});
