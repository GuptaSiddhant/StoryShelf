import { describe, expect, it } from "vitest";
import { RequestError, type BuildState } from "../client.ts";
import { createReporter } from "../output.ts";
import { parseTimeout, waitForBuild, WAIT_EXIT, type WaitOptions } from "./wait.ts";

const LINK = "https://shelf.example.com/projects/demo/builds/b1";

/** A frozen clock: it moves only when the wait sleeps, by exactly the time slept. */
function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void>; slept: number[] } {
  let time = 0;
  const slept: number[] = [];
  return {
    now: () => time,
    sleep: async (ms) => {
      await Promise.resolve();
      slept.push(ms);
      time += ms;
    },
    slept,
  };
}

/** The server's answers in order; the last one repeats. An Error is thrown instead of returned. */
function script(answers: (Partial<BuildState> | Error)[]): WaitOptions["client"] {
  let call = 0;
  return {
    projects: {
      builds: {
        get: async () => {
          await Promise.resolve();
          const answer = answers[Math.min(call, answers.length - 1)] as Partial<BuildState> | Error;
          call += 1;
          if (answer instanceof Error) throw answer;
          return { id: "b1", status: "pending", changedCount: 0, ...answer };
        },
      },
    },
  } as unknown as WaitOptions["client"];
}

interface Run {
  code: number;
  lines: string[];
  progress: string;
  clock: ReturnType<typeof fakeClock>;
}

async function run(
  answers: (Partial<BuildState> | Error)[],
  extra: Partial<WaitOptions> = {},
): Promise<Run> {
  const clock = fakeClock();
  let progress = "";
  const result = await waitForBuild({
    client: script(answers),
    slug: "demo",
    buildId: "b1",
    buildLink: LINK,
    hostingOnly: false,
    timeoutMs: 30 * 60_000,
    reporter: createReporter({
      interactive: false,
      color: false,
      now: clock.now,
      write: (text) => {
        progress += text;
      },
    }),
    now: clock.now,
    sleep: clock.sleep,
    ...extra,
  });
  return { ...result, progress, clock };
}

describe("waitForBuild exit codes", () => {
  it("0 when the build is approved", async () => {
    const { code, lines } = await run([
      { status: "capturing", publishing: "success", capture: { done: 1, total: 4 } },
      { status: "approved", publishing: "success" },
    ]);
    expect(code).toBe(WAIT_EXIT.approved);
    expect(lines).toEqual(["Build approved", `View: ${LINK}`]);
  });

  it("0 for a skipped build", async () => {
    expect((await run([{ status: "skipped" }])).code).toBe(0);
  });

  it("2 when changes need review, and the wait does not wait for a person", async () => {
    const { code, lines, clock } = await run([{ status: "reviewing", changedCount: 3 }]);
    expect(code).toBe(2);
    expect(lines).toEqual(["3 visual changes need review", `Review: ${LINK}`]);
    expect(clock.slept).toEqual([]);
  });

  it("3 when rejected", async () => {
    expect((await run([{ status: "rejected" }])).lines).toEqual([
      "Build rejected",
      `View: ${LINK}`,
    ]);
    expect((await run([{ status: "rejected" }])).code).toBe(3);
  });

  it("4 when failed, naming failing Storybook tests", async () => {
    const testResults = JSON.stringify([{ status: "failed" }, { status: "passed" }]);
    const { code, lines } = await run([{ status: "failed", testResults }]);
    expect(code).toBe(4);
    expect(lines[0]).toBe("Build failed: 1 Storybook test failed");
  });

  it("4 with the publishing reason, else a capture reason", async () => {
    expect((await run([{ status: "failed", publishing: "failure" }])).lines[0]).toBe(
      "Build failed: the Storybook could not be published",
    );
    expect((await run([{ status: "failed" }])).lines[0]).toBe(
      "Build failed: capture did not complete (the build page gives the reason)",
    );
  });

  it("5 when cancelled, and names the newer build when superseded", async () => {
    expect((await run([{ status: "cancelled" }])).code).toBe(5);
    const { code, lines } = await run([{ status: "cancelled", supersededByBuildId: "b2" }]);
    expect(code).toBe(5);
    expect(lines).toEqual([
      "Build superseded by build b2",
      "Newer build: https://shelf.example.com/projects/demo/builds/b2",
    ]);
  });

  it("6 at the timeout, still running, nothing cancelled", async () => {
    const { code, lines, clock } = await run([{ status: "capturing", publishing: "success" }], {
      timeoutMs: 60_000,
    });
    expect(code).toBe(6);
    expect(lines).toEqual([
      "Timed out waiting: still capturing; nothing was cancelled",
      `View: ${LINK}`,
    ]);
    expect(clock.now()).toBe(60_000);
  });
});

describe("waitForBuild hosting-only", () => {
  it("ends 0 once the Storybook is accepted on publish", async () => {
    const { code } = await run(
      [
        { status: "pending", publishing: "pending" },
        { status: "approved", publishing: "success" },
      ],
      { hostingOnly: true },
    );
    expect(code).toBe(0);
  });

  it("ends 2 when published and still waiting for a verdict", async () => {
    const { code, lines } = await run(
      [
        { status: "pending", publishing: "pending" },
        { status: "pending", publishing: "success" },
      ],
      { hostingOnly: true },
    );
    expect(code).toBe(2);
    expect(lines[0]).toBe("Storybook published; waiting for a review verdict");
  });

  it("ends 4 when publishing failed", async () => {
    const { code } = await run([{ status: "pending", publishing: "failure" }], {
      hostingOnly: true,
    });
    expect(code).toBe(4);
  });
});

describe("waitForBuild polling", () => {
  it("polls every 2s, backing off to 10s", async () => {
    const answers = Array.from({ length: 8 }, () => ({
      status: "capturing",
      publishing: "success" as const,
    }));
    const { clock } = await run([...answers, { status: "approved" }]);
    expect(clock.slept).toEqual([2000, 3000, 4500, 6750, 10_000, 10_000, 10_000, 10_000]);
  });

  it("honours Retry-After on a 429 or 503", async () => {
    const throttled = new RequestError(429, "slow down", 7000);
    const { code, clock } = await run([throttled, { status: "approved" }]);
    expect(code).toBe(0);
    expect(clock.slept).toEqual([7000]);
  });

  it("gives up after repeated transient failures, and rethrows other errors at once", async () => {
    await expect(run([new RequestError(503, "down")])).rejects.toThrow("503");
    await expect(run([new RequestError(401, "no")])).rejects.toThrow("401");
  });

  it("prints a phase per stage, one line each in a log, with capture progress", async () => {
    const { progress } = await run([
      { status: "pending", publishing: "pending" },
      { status: "capturing", publishing: "success", capture: { done: 120, total: 860 } },
      { status: "approved" },
    ]);
    expect(progress).toMatchInlineSnapshot(`
      "==> Publishing
      --> Published (2.0s)
      ==> Capturing
      --> Captured (3.0s)
      "
    `);
    expect(progress).not.toContain("\r");
  });

  it("redraws capture progress on a terminal", async () => {
    const clock = fakeClock();
    let progress = "";
    await waitForBuild({
      client: script([
        { status: "capturing", publishing: "success", capture: { done: 120, total: 860 } },
        { status: "approved" },
      ]),
      slug: "demo",
      buildId: "b1",
      buildLink: null,
      hostingOnly: false,
      timeoutMs: 60_000,
      reporter: createReporter({
        interactive: true,
        color: false,
        now: clock.now,
        write: (text) => {
          progress += text;
        },
      }),
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(progress).toContain("120/860 stories");
  });

  it("Ctrl+C stops waiting only: exit 130, nothing cancelled", async () => {
    const controller = new AbortController();
    const clock = fakeClock();
    const { code, lines } = await run([{ status: "capturing", publishing: "success" }], {
      signal: controller.signal,
      sleep: async (ms) => {
        await clock.sleep(ms);
        controller.abort();
      },
    });
    expect(code).toBe(130);
    expect(lines[0]).toBe("Stopped waiting: still capturing; nothing was cancelled");
  });
});

describe("parseTimeout", () => {
  it("reads seconds, minutes and hours; a bare number is seconds", () => {
    expect(parseTimeout("90")).toBe(90_000);
    expect(parseTimeout("90s")).toBe(90_000);
    expect(parseTimeout("30m")).toBe(1_800_000);
    expect(parseTimeout("2h")).toBe(7_200_000);
  });

  it("refuses anything else", () => {
    for (const bad of ["", "0", "-5", "1d", "abc", "1.5m"]) {
      expect(() => parseTimeout(bad)).toThrow("not a duration");
    }
  });
});
