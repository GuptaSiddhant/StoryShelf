import { describe, expect, it } from "vitest";
import { assetManifest } from "../asset-manifest.ts";
import { htmxSource, htmxVersion } from "./htmx.ts";
import { markSource } from "./mark.ts";

describe("embedded assets", () => {
  it("embeds the htmx build whose version the module declares", () => {
    expect(htmxSource).toContain(`version: "${htmxVersion}"`);
    expect(htmxSource).toContain("htmx");
  });

  it("embeds the brand mark as a complete SVG", () => {
    expect(markSource.startsWith("<svg ")).toBe(true);
    expect(markSource.endsWith("</svg>")).toBe(true);
  });

  it("serves exactly the embedded sources, each under its own content hash", () => {
    expect(assetManifest.htmx.source).toBe(htmxSource);
    expect(assetManifest.mark.source).toBe(markSource);
    expect(assetManifest.htmx.href).toBe(`/assets/htmx-${assetManifest.htmx.hash}.js`);
    expect(assetManifest.mark.href).toBe(`/assets/mark-${assetManifest.mark.hash}.svg`);
  });
});
