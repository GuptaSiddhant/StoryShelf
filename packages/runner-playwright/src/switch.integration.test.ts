import type { RenderedSnapshot, StoryEntry } from "@storyshelf/core/adapter/capture-runner";
import { StorybookAdapter } from "@storyshelf/core/capture";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createPlaywrightCaptureRunner } from "./capture-runner.ts";
import { ensureFixtureBuilt } from "./integration-harness.ts";

/**
 * ADR 0052's correctness gate (decision 9) on whichever fixture `FIXTURE_DIR` names: every
 * snapshot taken with story switching on is byte-identical to the one taken with it off, over
 * three runs, one in reverse story order and one with a different page count, the deliberately
 * leaking stories included. Decision 5's second pass is not involved: the runner is called
 * directly, so a leak would show as a difference here instead of being repaired.
 */
const viewports = [
  { name: "desktop", width: 800, height: 600 },
  { name: "narrow", width: 420, height: 700 },
];

const logger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child() {
    return this;
  },
});

type Shots = Map<string, Buffer>;

const keyOf = (capture: RenderedSnapshot): string =>
  JSON.stringify([capture.story.id, capture.viewportName]);

let staticDir = "";
let stories: StoryEntry[] = [];
let fresh: Shots = new Map();

async function render(options: {
  switching: boolean;
  concurrency: number;
  order?: StoryEntry[];
}): Promise<{ shots: Shots; switched: number; ms: number }> {
  const runner = createPlaywrightCaptureRunner({ concurrency: options.concurrency });
  const log = logger();
  const list = options.order ?? stories;
  const started = performance.now();
  const result = await runner.render({
    buildId: `switch-${String(options.switching)}`,
    storybookDir: staticDir,
    stories: list,
    viewports,
    logger: log as never,
    runA11y: false,
    ...(options.switching
      ? {
          switchStories: {
            baselined: list.flatMap((story) =>
              viewports.map((viewport) => ({ storyId: story.id, viewportName: viewport.name })),
            ),
          },
        }
      : {}),
  });
  const ms = Math.round(performance.now() - started);
  const summary = log.info.mock.calls.find((call) =>
    String(call[1]).startsWith("story switching:"),
  );
  if (summary) process.stdout.write(`  ${JSON.stringify(summary[0])}\n`);
  return {
    shots: new Map(result.captures.map((capture) => [keyOf(capture), capture.screenshot])),
    switched: result.captures.filter((capture) => capture.switched).length,
    ms,
  };
}

function differences(shots: Shots): string[] {
  const out: string[] = [];
  for (const [key, expected] of fresh) {
    const got = shots.get(key);
    if (!got || !got.equals(expected)) out.push(key);
  }
  return out;
}

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")("story switching gate (ADR 0052)", () => {
  beforeAll(async () => {
    staticDir = await ensureFixtureBuilt();
    stories = (await new StorybookAdapter().discover(staticDir)).filter(
      (story) => story.type === "story" && story.parentId === undefined,
    );
    const first = await render({ switching: false, concurrency: 2 });
    const second = await render({ switching: false, concurrency: 2 });
    fresh = first.shots;
    // The gate means nothing if a fresh page is not reproducible on its own.
    expect(
      [...second.shots.keys()].filter(
        (key) => !second.shots.get(key)?.equals(fresh.get(key) ?? Buffer.alloc(0)),
      ),
    ).toEqual([]);
    process.stdout.write(`fresh pages: ${String(first.ms)} ms, ${String(fresh.size)} snapshots\n`);
  }, 600_000);

  it("includes the deliberately leaking stories", () => {
    expect(stories.filter((story) => story.title === "Leaks").length).toBeGreaterThanOrEqual(8);
  });

  it.each([1, 2, 3])(
    "run %i: every switched snapshot is byte-identical",
    async (run) => {
      const result = await render({ switching: true, concurrency: 2 });
      process.stdout.write(
        `switched run ${String(run)}: ${String(result.ms)} ms, ${String(result.switched)} switched\n`,
      );
      expect(differences(result.shots)).toEqual([]);
      expect(result.switched).toBeGreaterThan(0);
    },
    600_000,
  );

  it("reverse story order: byte-identical", async () => {
    const result = await render({
      switching: true,
      concurrency: 2,
      order: stories.toReversed(),
    });
    process.stdout.write(
      `reverse order: ${String(result.ms)} ms, ${String(result.switched)} switched\n`,
    );
    expect(differences(result.shots)).toEqual([]);
  }, 600_000);

  it("a different page count: byte-identical", async () => {
    const result = await render({ switching: true, concurrency: 3 });
    process.stdout.write(
      `three pages: ${String(result.ms)} ms, ${String(result.switched)} switched\n`,
    );
    expect(differences(result.shots)).toEqual([]);
  }, 600_000);

  it("one page: the longest sessions, byte-identical", async () => {
    const result = await render({ switching: true, concurrency: 1 });
    process.stdout.write(
      `one page: ${String(result.ms)} ms, ${String(result.switched)} switched\n`,
    );
    expect(differences(result.shots)).toEqual([]);
  }, 600_000);
});
