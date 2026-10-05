/**
 * Published notifier contract suite for first- and third-party providers.
 *
 * Structural conformance (identity, descriptor, config schema). Message
 * delivery stays per-package behind faked transports.
 */
import { describe, expect, it } from "vitest";
import type { NotifierProvider } from "../adapters/notifier/provider.ts";

/** Build the provider under test (sync or async factories both work). */
export type NotifierFactory = () => NotifierProvider | Promise<NotifierProvider>;

/** Run the notifier contract against a factory. */
export function notifierContractSuite(label: string, make: NotifierFactory): void {
  describe(`notifier contract: ${label}`, () => {
    it("exposes notifier metadata with a config schema", async () => {
      const provider = await make();
      expect(provider.metadata.category).toBe("notifier");
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
