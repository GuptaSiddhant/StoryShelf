/**
 * Published git-host contract suite for first- and third-party providers.
 *
 * Structural conformance (identity, descriptor, config schema). Status
 * posting stays per-package behind faked transports.
 */
import { describe, expect, it } from "vitest";
import type { GitHostProvider } from "../adapters/git-host/index.ts";

/** Build the provider under test (sync or async factories both work). */
export type GitFactory = () => GitHostProvider | Promise<GitHostProvider>;

/** Run the git-host contract against a factory. */
export function gitContractSuite(label: string, make: GitFactory): void {
  describe(`git-host contract: ${label}`, () => {
    it("exposes git-host metadata with a config schema", async () => {
      const provider = await make();
      expect(provider.metadata.category).toBe("git-host");
      expect(provider.metadata.kind.length).toBeGreaterThan(0);
      expect(typeof provider.metadata.schema.parse).toBe("function");
    });

    it("exposes the create descriptor", async () => {
      const provider = await make();
      expect(typeof provider.create).toBe("function");
    });

    it("validates channel config through a real schema", async () => {
      const provider = await make();
      const result = provider.metadata.schema.safeParse({});
      expect(typeof result.success).toBe("boolean");
    });
  });
}
