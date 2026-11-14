import type { RenderedSnapshot, StoryEntry } from "@storyshelf/core/adapter/capture-runner";
import type { SwitchSession } from "@storyshelf/core/capture";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { runSession, type SessionRun } from "./sessions.ts";

const mocks = vi.hoisted(() => ({
  acquirePage: vi.fn(),
  runCapture: vi.fn(),
  prepareSwitch: vi.fn(),
  captureSwitched: vi.fn(),
  installDocumentRecorder: vi.fn(async () => {}),
}));
vi.mock("./pages.ts", () => ({ acquirePage: mocks.acquirePage }));
vi.mock("./screenshot.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./screenshot.ts")>()),
  runCapture: mocks.runCapture,
}));
vi.mock("./switch-capture.ts", () => ({
  prepareSwitch: mocks.prepareSwitch,
  captureSwitched: mocks.captureSwitched,
}));
vi.mock("./switch-page.ts", () => ({ installDocumentRecorder: mocks.installDocumentRecorder }));

const viewport = { name: "desktop", width: 800, height: 600 };
const story = (id: string): StoryEntry => ({ id, title: "T", name: id, type: "story" });
const session = (...ids: string[]): SwitchSession => ({
  jobs: ids.map((id) => ({ story: story(id), viewport })),
});
const shot = (id: string) => ({
  screenshot: Buffer.from(id),
  a11yViolations: [],
  story: story(id),
});

let releases: boolean[] = [];

type OnCapture = Mock<(capture: RenderedSnapshot) => Promise<void>>;

function run(): SessionRun & { onCapture: OnCapture } {
  const onCapture = vi.fn<(capture: RenderedSnapshot) => Promise<void>>(async () => {});
  return {
    input: {
      buildId: "b",
      storybookDir: "/sb",
      stories: [],
      viewports: [],
      onCapture,
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as never,
    },
    active: { cancelled: false } as SessionRun["active"],
    ctx: {} as never,
    out: { captures: [], failures: [] },
    stats: { switched: 0, ended: {} },
    check: vi.fn(),
    onCapture,
  };
}

const delivered = (onCapture: OnCapture) =>
  onCapture.mock.calls.map((call) => {
    const capture = call[0] as { story: StoryEntry; switched?: boolean };
    return `${capture.story.id}${capture.switched ? "~" : ""}`;
  });

beforeEach(() => {
  releases = [];
  mocks.acquirePage.mockReset().mockImplementation(async () => ({
    page: { setDefaultTimeout: vi.fn(), on: vi.fn(), off: vi.fn() },
    release: async (reusable: boolean) => {
      releases.push(reusable);
    },
  }));
  mocks.runCapture
    .mockReset()
    .mockImplementation(async (_page, _ctx, entry: StoryEntry) => shot(entry.id));
  mocks.prepareSwitch.mockReset().mockResolvedValue(null);
  mocks.captureSwitched
    .mockReset()
    .mockImplementation(async (_page, _ctx, entry: StoryEntry) => shot(entry.id));
});

describe("runSession", () => {
  it("loads the first story fresh and switches to the rest on the same page", async () => {
    const one = run();
    expect(await runSession(one, session("a", "b", "c"))).toBe(false);
    expect(delivered(one.onCapture)).toEqual(["a", "b~", "c~"]);
    expect(one.stats).toEqual({ switched: 2, ended: {} });
    expect(mocks.acquirePage).toHaveBeenCalledTimes(1);
    expect(releases).toEqual([true]);
  });

  it("captures a story whose switch failed again, as the first of a fresh page", async () => {
    mocks.captureSwitched.mockImplementationOnce(async () => "failed");
    const one = run();
    await runSession(one, session("a", "b", "c"));
    expect(delivered(one.onCapture)).toEqual(["a", "b", "c~"]);
    expect(one.stats).toEqual({ switched: 1, ended: { failed: 1 } });
    expect(mocks.acquirePage).toHaveBeenCalledTimes(2);
  });

  it("treats a switch that threw like any other failed switch", async () => {
    mocks.captureSwitched.mockImplementationOnce(async () => {
      throw new Error("page crashed");
    });
    const one = run();
    await runSession(one, session("a", "b"));
    expect(delivered(one.onCapture)).toEqual(["a", "b"]);
    expect(one.out.failures).toEqual([]);
  });

  it("ends the session when the document drifted, before switching", async () => {
    mocks.prepareSwitch.mockResolvedValueOnce("body");
    const one = run();
    await runSession(one, session("a", "b"));
    expect(delivered(one.onCapture)).toEqual(["a", "b"]);
    expect(one.stats.ended).toEqual({ body: 1 });
    expect(mocks.captureSwitched).not.toHaveBeenCalled();
  });

  it("does not switch from a first story that ended the session", async () => {
    mocks.runCapture.mockImplementationOnce(async () => ({ ...shot("a"), ends: "play" }));
    const one = run();
    await runSession(one, session("a", "b"));
    expect(delivered(one.onCapture)).toEqual(["a", "b"]);
    expect(one.stats.ended).toEqual({ play: 1 });
  });

  it("keeps a switched capture that ends the session and goes on with a fresh page", async () => {
    mocks.captureSwitched.mockImplementationOnce(async () => ({ ...shot("b"), ends: "paused" }));
    const one = run();
    await runSession(one, session("a", "b", "c"));
    expect(delivered(one.onCapture)).toEqual(["a", "b~", "c"]);
    expect(one.stats).toEqual({ switched: 1, ended: { paused: 1 } });
  });

  it("records a first story that fails, discards its page and goes on", async () => {
    mocks.runCapture.mockImplementationOnce(async () => {
      throw new Error("Timeout 30000ms exceeded");
    });
    const one = run();
    expect(await runSession(one, session("a", "b"))).toBe(true);
    expect(one.out.failures).toEqual([
      { storyId: "a", viewportName: "desktop", error: "Timeout 30000ms exceeded" },
    ]);
    expect(delivered(one.onCapture)).toEqual(["b"]);
    expect(releases).toEqual([false, true]);
  });

  it("records a switched capture whose hand-off failed against that story", async () => {
    const one = run();
    one.onCapture.mockImplementation(async (capture) => {
      if (capture.switched === true) throw new Error("storage down");
    });
    await runSession(one, session("a", "b"));
    expect(one.out.failures).toEqual([
      { storyId: "b", viewportName: "desktop", error: "storage down" },
    ]);
  });

  it("stops when the run is cancelled", async () => {
    const one = run();
    one.check = vi.fn(() => {
      throw new Error("Capture cancelled");
    });
    await expect(runSession(one, session("a"))).rejects.toThrow("Capture cancelled");
  });
});
