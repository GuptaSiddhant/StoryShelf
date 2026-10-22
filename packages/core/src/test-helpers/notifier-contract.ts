/**
 * Published notifier contract suites for first- and third-party providers.
 *
 * Structural conformance (identity, descriptor, config schema). Message
 * and state delivery stay per-package behind faked transports.
 */
import { describe, expect, it } from "vitest";
import type { NotifierProvider } from "../adapters/notifier/provider.ts";
import { isStateProvider } from "../adapters/notifier/provider.ts";

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

/**
 * Run the `state` delivery contract against a factory: the provider declares
 * `delivery: "state"`, binds a valid `config` to an adapter that can `setState`,
 * and rejects an invalid config at `create`.
 */
export function stateNotifierContractSuite(
  label: string,
  make: NotifierFactory,
  validConfig: unknown,
): void {
  notifierContractSuite(label, make);
  describe(`state notifier contract: ${label}`, () => {
    it("declares state delivery", async () => {
      const provider = await make();
      expect(isStateProvider(provider)).toBe(true);
    });

    it("binds a valid config to an adapter that can set state", async () => {
      const provider = await make();
      const adapter = provider.create({ config: validConfig, secret: "token" });
      expect("setState" in adapter && typeof adapter.setState === "function").toBe(true);
    });

    it("rejects an invalid config at create", async () => {
      const provider = await make();
      expect(() => provider.create({ config: {}, secret: "token" })).toThrow();
    });
  });
}
