import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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

  it("embeds exactly the htmx source whose checksum is recorded", async () => {
    const recorded = JSON.parse(
      await readFile(new URL("htmx.sha256.json", import.meta.url), "utf8"),
    ) as {
      version: string;
      upstream: { sha256: string };
      embedded: { sha256: string; bytes: number };
    };
    const fix = "If the change is intended, regenerate it with scripts/embed-htmx.ts.";
    expect(recorded.version, fix).toBe(htmxVersion);
    expect(Buffer.byteLength(htmxSource), fix).toBe(recorded.embedded.bytes);
    expect(createHash("sha256").update(htmxSource).digest("hex"), fix).toBe(
      recorded.embedded.sha256,
    );
    expect(recorded.upstream.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });
});
