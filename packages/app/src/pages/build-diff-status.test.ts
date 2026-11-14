import type { Build, CaptureAttempt, CaptureLog } from "@storyshelf/core/schema";
import { describe, expect, it } from "vitest";
import type { BuildDetailsData } from "./build-detail.tsx";
import { failureReason, isCapturing, isRetryable, statusView } from "./build-diff-status.ts";

const build = (status: Build["status"]): Build => ({ status }) as Build;
const attempt = (error: string | null, logs: Partial<CaptureLog>[] = []) => ({
  attempt: { id: "a", error } as CaptureAttempt,
  logs: logs as CaptureLog[],
});
const details = (attempts: BuildDetailsData["attempts"], published = false): BuildDetailsData => ({
  testing: true,
  published,
  labels: [],
  components: null,
  stories: null,
  attempts,
  review: null,
});

describe("statusView", () => {
  it("names every status in sentence case", () => {
    expect(statusView(build("reviewing")).label).toBe("Needs review");
    expect(statusView(build("failed"))).toMatchObject({ label: "Capture failed", tone: "danger" });
    expect(statusView(build("cancelled")).tone).toBe("neutral");
  });

  it("calls an upload without capture Published", () => {
    expect(statusView(build("approved"), details([], true)).label).toBe("Published");
  });
});

describe("build state helpers", () => {
  it("treats pending, capturing and comparing as still capturing", () => {
    expect(
      ["pending", "capturing", "comparing"].map((s) => isCapturing(build(s as never))),
    ).toEqual([true, true, true]);
    expect(isCapturing(build("failed"))).toBe(false);
    expect(isCapturing(build("cancelled"))).toBe(false);
  });

  it("offers retry for failed and cancelled builds only", () => {
    expect(isRetryable(build("failed"))).toBe(true);
    expect(isRetryable(build("cancelled"))).toBe(true);
    expect(isRetryable(build("reviewing"))).toBe(false);
  });
});

describe("failureReason", () => {
  it("is the first line of the last attempt's error", () => {
    expect(failureReason(details([attempt("old"), attempt("\npage.goto: 404\nstack trace")]))).toBe(
      "page.goto: 404",
    );
  });

  it("falls back to the last error log line, and to null", () => {
    expect(
      failureReason(
        details([
          attempt(null, [
            { level: "error", message: "boom" },
            { level: "info", message: "x" },
          ]),
        ]),
      ),
    ).toBe("boom");
    expect(failureReason(details([attempt(null)]))).toBeNull();
    expect(failureReason(details([]))).toBeNull();
    expect(failureReason()).toBeNull();
  });
});
