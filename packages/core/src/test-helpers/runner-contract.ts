/**
 * Published runner contract suite for first- and third-party adapters.
 *
 * Structural conformance (identity, render/cancel presence). Behavioral
 * rendering stays per-package behind real or mocked browsers — the
 * orchestrator owns timeouts, byte guards, and failure caps, so runners
 * only promise to return PNG buffers and honor `cancel`.
 */
import { describe, expect, it } from "vitest";
import type { CaptureRunner } from "../adapters/capture-runner.ts";

/** Build the adapter under test (sync or async factories both work). */
export type RunnerFactory = () => CaptureRunner | Promise<CaptureRunner>;

/** Run the runner contract against a factory. */
export function runnerContractSuite(label: string, make: RunnerFactory): void {
  describe(`runner contract: ${label}`, () => {
    it("exposes capture-runner metadata", async () => {
      const runner = await make();
      expect(runner.metadata.category).toBe("capture-runner");
      expect(runner.metadata.kind.length).toBeGreaterThan(0);
    });

    it("exposes render and cancel", async () => {
      const runner = await make();
      expect(typeof runner.render).toBe("function");
      expect(typeof runner.cancel).toBe("function");
    });
  });
}
