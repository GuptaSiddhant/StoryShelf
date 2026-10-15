/**
 * Published design-provider contract suite for first- and third-party providers.
 *
 * Structural conformance (identity, descriptor, link parsing). Vendor API calls
 * stay per-package behind faked transports.
 */
import { describe, expect, it } from "vitest";
import type { DesignProvider } from "../adapters/design.ts";

/** Build the provider under test (sync or async factories both work). */
export type DesignFactory = () => DesignProvider | Promise<DesignProvider>;

/** Links the suite uses to probe `parseUrl`. */
export interface DesignContractSamples {
  /** A link the provider must accept, with the file key it must yield. */
  valid: { url: string; fileKey: string };
  /** A link the provider must reject. */
  invalid: string;
}

/** Run the design-provider contract against a factory. */
export function designContractSuite(
  label: string,
  make: DesignFactory,
  samples: DesignContractSamples,
): void {
  describe(`design contract: ${label}`, () => {
    it("exposes design metadata with credential copy", async () => {
      const { metadata } = await make();
      expect(metadata.category).toBe("design");
      expect(metadata.kind.length).toBeGreaterThan(0);
      expect(metadata.credentialLabel.length).toBeGreaterThan(0);
      expect(metadata.credentialHelp.length).toBeGreaterThan(0);
      expect(metadata.urlHint.length).toBeGreaterThan(0);
    });

    it("parses its own links and rejects foreign ones", async () => {
      const provider = await make();
      expect(provider.parseUrl(samples.valid.url)?.fileKey).toBe(samples.valid.fileKey);
      expect(provider.parseUrl(samples.invalid)).toBeNull();
      expect(provider.parseUrl("not a url")).toBeNull();
      expect(provider.parseUrl("")).toBeNull();
    });

    it("creates a client with both fetch methods", async () => {
      const client = (await make()).create({ credential: "test-credential" });
      expect(typeof client.fetchMetas).toBe("function");
      expect(typeof client.fetchRenders).toBe("function");
    });
  });
}
