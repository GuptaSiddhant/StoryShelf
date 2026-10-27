import { describe, expect, it } from "vitest";
import { endAttempt, startAttempt, stopAllAttempts } from "./remote-lease-attempt.ts";

describe("startAttempt", () => {
  it("stops with the run's signal, and is stopped at once when it is already aborted", () => {
    const run = new AbortController();
    const attempt = startAttempt(run.signal);
    expect(attempt.stopped).toBe(false);
    run.abort();
    expect(attempt.stopped).toBe(true);
    expect(attempt.controller.signal.aborted).toBe(true);
    expect(startAttempt(run.signal).stopped).toBe(true);
  });

  it("stops listening to the run once the attempt ends", () => {
    const run = new AbortController();
    const attempt = startAttempt(run.signal);
    endAttempt(attempt);
    run.abort();
    expect(attempt.stopped).toBe(false);
  });

  it("works without a run signal", () => {
    const attempt = startAttempt();
    endAttempt(attempt);
    expect(attempt.stopped).toBe(false);
  });
});

describe("stopAllAttempts", () => {
  it("stops every attempt still pending, but not one that ended", () => {
    const pending = startAttempt();
    const done = startAttempt();
    endAttempt(done);
    stopAllAttempts();
    expect(pending.stopped).toBe(true);
    expect(done.stopped).toBe(false);
    endAttempt(pending);
  });
});
