import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";
import type { AttemptLogRecorder } from "../models/capture-attempt.ts";
import { mirrorAttemptLog } from "./attempt-logger.ts";

function fakeLogger(): { logger: Logger; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const logger = {
    info: (...args: unknown[]) => calls.push(["info", ...args]),
    warn: (...args: unknown[]) => calls.push(["warn", ...args]),
    error: (...args: unknown[]) => calls.push(["error", ...args]),
    debug: (...args: unknown[]) => calls.push(["debug", ...args]),
  } as unknown as Logger;
  return { logger, calls };
}

describe("mirrorAttemptLog", () => {
  it("records info/warn/error from the runner logger and keeps debug in pino only", async () => {
    const { logger, calls } = fakeLogger();
    const lines: [string, string, unknown][] = [];
    const record: AttemptLogRecorder = async (level, message, fields) => {
      await Promise.resolve();
      lines.push([level, message, fields]);
    };
    const mirror = mirrorAttemptLog(logger, record);

    mirror.logger.info({ pages: 2 }, "capture sizing");
    mirror.logger.warn({ storyId: "a" }, "a11y violations found");
    mirror.logger.debug({ noisy: true }, "debug detail");
    mirror.logger.info("plain message");
    await mirror.flush();

    expect(lines).toEqual([
      ["info", "capture sizing", { pages: 2 }],
      ["warn", "a11y violations found", { storyId: "a" }],
      ["info", "plain message", undefined],
    ]);
    // Every call still reaches the original logger, debug included.
    expect(calls.map((call) => call[0])).toEqual(["info", "warn", "debug", "info"]);
    expect(calls.at(-1)).toEqual(["info", "plain message"]);
  });

  it("records an Error as its capped message", async () => {
    const lines: unknown[] = [];
    const mirror = mirrorAttemptLog(fakeLogger().logger, async (_level, _message, fields) => {
      await Promise.resolve();
      lines.push(fields);
    });

    mirror.logger.error(
      { storyId: "a", err: new Error("x".repeat(900)) },
      "render failed for story",
    );
    await mirror.flush();

    expect((lines[0] as { err: string }).err).toHaveLength(500);
  });

  it("writes lines one at a time so concurrent failures cannot collide", async () => {
    let active = 0;
    let peak = 0;
    const record: AttemptLogRecorder = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => {
        setTimeout(resolve, 2);
      });
      active -= 1;
    };
    const mirror = mirrorAttemptLog(fakeLogger().logger, record);

    for (let i = 0; i < 8; i += 1) mirror.logger.error({ i }, "render failed for story");
    await mirror.flush();

    expect(peak).toBe(1);
  });

  it("can re-level a recorded line without changing what pino receives", async () => {
    const { logger, calls } = fakeLogger();
    const levels: string[] = [];
    const mirror = mirrorAttemptLog(
      logger,
      async (level) => {
        await Promise.resolve();
        levels.push(level);
      },
      (level, fields) => (fields?.["flaky"] ? "warn" : level),
    );

    mirror.logger.error({ flaky: true }, "render failed for story");
    mirror.logger.error({ flaky: false }, "render failed for story");
    await mirror.flush();

    expect(levels).toEqual(["warn", "error"]);
    expect(calls.map((call) => call[0])).toEqual(["error", "error"]);
  });

  it("never throws when the recorder fails", async () => {
    const { logger } = fakeLogger();
    const warn = vi.spyOn(logger, "warn");
    const mirror = mirrorAttemptLog(logger, async () => {
      await Promise.resolve();
      throw new Error("db down");
    });

    mirror.log("info", "x");
    await expect(mirror.flush()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("works without a recorder or a logger", async () => {
    const { logger, record }: { logger?: Logger; record?: AttemptLogRecorder } = {};
    const mirror = mirrorAttemptLog(logger, record);
    mirror.logger.info({ a: 1 }, "no-op");
    mirror.log("warn", "also no-op");
    await expect(mirror.flush()).resolves.toBeUndefined();
  });
});
