import type { StoryEntry } from "@storyshelf/core/adapter/capture-runner";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPuppeteerCaptureRunner } from "./capture-runner.ts";
import { cdp } from "./remote/cdp.ts";
import { createStaticServer, type StaticServer } from "./static-server.ts";

/**
 * Remote capture over CDP: a separate Chrome process with remote debugging stands in for the
 * browser service, and the build is opened from a URL (the Puppeteer runner has no route back to
 * the loopback server). Needs a Chrome: set `PUPPETEER_EXECUTABLE_PATH` (puppeteer-core ships
 * none) and `FIXTURE_DIR` (default storybook-8).
 */
const FIXTURE_DIR = process.env["FIXTURE_DIR"]
  ? resolve(process.env["FIXTURE_DIR"])
  : resolve(import.meta.dirname ?? ".", "..", "..", "..", "fixtures", "storybook-8");
const CHROME = process.env["PUPPETEER_EXECUTABLE_PATH"];

const STORIES: StoryEntry[] = [
  { id: "components-button--primary", title: "Components/Button", name: "Primary", type: "story" },
  {
    id: "components-button--secondary",
    title: "Components/Button",
    name: "Secondary",
    type: "story",
  },
];

async function freePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => {
        resolvePort(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
  });
}

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")("remote capture over CDP", () => {
  let chrome: ChildProcess | null = null;
  let port = 0;
  let served: StaticServer | null = null;

  beforeAll(async () => {
    port = await freePort();
    chrome = spawn(
      CHROME ?? "google-chrome",
      ["--headless", "--no-sandbox", `--remote-debugging-port=${port}`, "about:blank"],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    await new Promise<void>((done, reject) => {
      chrome?.once("error", reject);
      chrome?.stderr?.on("data", (chunk: Buffer) => {
        if (String(chunk).includes("DevTools listening")) done();
      });
    });
    served = await createStaticServer(join(FIXTURE_DIR, "storybook-static"));
  }, 60_000);

  afterAll(async () => {
    chrome?.kill();
    await served?.close();
  });

  it("renders from the URL it is given and measures the fingerprint inside the remote browser", async () => {
    const runner = createPuppeteerCaptureRunner({
      browsers: [
        cdp({
          name: "remote",
          endpoint: `http://127.0.0.1:${port}`,
          sessions: 2,
          engines: ["chromium"],
        }),
      ],
    });
    const result = await runner.render({
      buildId: "remote-cdp",
      storybookDir: join(FIXTURE_DIR, "storybook-static"),
      storybookUrl: `${served?.url}/`,
      stories: STORIES,
      viewports: [{ name: "desktop", width: 1280, height: 720 }],
    });
    expect(result.failures).toEqual([]);
    expect(result.captures).toHaveLength(2);
    expect(result.captures[0]?.browser).toBe("chromium@remote");
    expect(
      Buffer.from(result.captures[0]?.screenshot ?? [])
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG");
    expect(result.environment).toMatchObject({
      browserVersion: expect.stringMatching(/\d+\./u),
      platform: "linux",
      deviceScaleFactor: 1,
    });
  }, 120_000);
});
