import { describe, expect, it } from "vitest";
import { decideCaptureProcess, FORK_MIN_CPUS, FORK_MIN_MEMORY_BYTES } from "./decision.ts";

const roomy = { cpus: 4, memoryBytes: 8 * 1024 ** 3, canFork: true };

describe("decideCaptureProcess", () => {
  it("forks on a roomy host", () => {
    expect(decideCaptureProcess(roomy)).toEqual({ mode: "fork" });
  });

  it("stays in-process when child processes are unavailable", () => {
    expect(decideCaptureProcess({ ...roomy, canFork: false })).toMatchObject({
      mode: "in-process",
    });
  });

  it("stays in-process on too few CPUs, including a fractional container quota", () => {
    expect(decideCaptureProcess({ ...roomy, cpus: FORK_MIN_CPUS - 1 }).mode).toBe("in-process");
    expect(decideCaptureProcess({ ...roomy, cpus: 1.5 }).mode).toBe("in-process");
    expect(decideCaptureProcess({ ...roomy, cpus: FORK_MIN_CPUS }).mode).toBe("fork");
  });

  it("stays in-process when memory is below the threshold", () => {
    expect(decideCaptureProcess({ ...roomy, memoryBytes: FORK_MIN_MEMORY_BYTES - 1 }).mode).toBe(
      "in-process",
    );
    expect(decideCaptureProcess({ ...roomy, memoryBytes: FORK_MIN_MEMORY_BYTES }).mode).toBe(
      "fork",
    );
  });

  it("explains why", () => {
    const decision = decideCaptureProcess({ ...roomy, cpus: 1 });
    expect(decision).toEqual({ mode: "in-process", reason: expect.stringContaining("CPU") });
  });
});
