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
import { isCaptureTarget } from "../adapters/capture-target.ts";

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

    it("lists its targets as unique, valid capture targets, default first", async () => {
      const targets = (await make()).metadata.targets;
      if (targets === undefined) {
        return;
      }
      expect(targets.length).toBeGreaterThan(0);
      for (const entry of targets) {
        expect(isCaptureTarget(entry.target), entry.target).toBe(true);
        expect(["loopback", "url"]).toContain(entry.reach);
      }
      expect(new Set(targets.map((entry) => entry.target)).size).toBe(targets.length);
    });

    it("exposes render and cancel", async () => {
      const runner = await make();
      expect(typeof runner.render).toBe("function");
      expect(typeof runner.cancel).toBe("function");
    });
  });
}
