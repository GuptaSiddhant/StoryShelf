import type { createShelfApp } from "@storyshelf/app";
import { describe, expect, it, vi } from "vite-plus/test";
import { waitForAttemptFinished } from "./integration-harness.ts";

type App = ReturnType<typeof createShelfApp>;

/** A fake app whose attempt endpoint answers with the given attempts in order, then repeats the last. */
function appAnswering(attempts: readonly { status: string; failedCount: number }[]) {
  const request = vi.fn((_path: string) => {
    const index = Math.min(request.mock.calls.length - 1, attempts.length - 1);
    return Promise.resolve(Response.json(attempts[index]));
  });
  return { app: { request } as unknown as App, request };
}

describe("waitForAttemptFinished", () => {
  it("keeps polling while the attempt is queued or running, then returns its final counts", async () => {
    const { app, request } = appAnswering([
      { status: "queued", failedCount: 0 },
      { status: "running", failedCount: 0 },
      { status: "failed", failedCount: 1 },
    ]);

    const attempt = await waitForAttemptFinished(app, "demo", "b1", 1);

    // An implementation that returned on the first (or second) answer would stop sooner and
    // report the default count of 0.
    expect(request).toHaveBeenCalledTimes(3);
    expect(attempt).toEqual({ status: "failed", failedCount: 1 });
    expect(request).toHaveBeenLastCalledWith("/api/v1/projects/demo/builds/b1/attempts/1");
  });

  it("returns at once when the attempt has already finished", async () => {
    const { app, request } = appAnswering([{ status: "completed", failedCount: 0 }]);

    await expect(waitForAttemptFinished(app, "demo", "b1", 2)).resolves.toEqual({
      status: "completed",
      failedCount: 0,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/api/v1/projects/demo/builds/b1/attempts/2");
  });

  it("throws when the attempt is still running once the timeout has passed", async () => {
    const { app, request } = appAnswering([{ status: "running", failedCount: 0 }]);

    // A negative timeout is already exceeded after the first poll, so no clock is involved.
    await expect(waitForAttemptFinished(app, "demo", "b1", 1, -1)).rejects.toThrow(
      "timed out waiting for attempt 1 of build b1 to finish",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});
