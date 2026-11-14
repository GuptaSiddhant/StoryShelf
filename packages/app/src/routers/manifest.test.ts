import { createShelfLogger } from "@storyshelf/core/logger";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { assetManifest } from "../asset-manifest.ts";
import { createShelfApp } from "../index.tsx";
import { classOfRoute } from "../routes/classification.ts";
import { stubAuth } from "../stub-auth.ts";
import { DARK_THEME, LIGHT_THEME } from "../ui/theme.ts";

function makeApp(
  ui?: Record<string, unknown>,
  signedOut = false,
): ReturnType<typeof createShelfApp> {
  return createShelfApp({
    database: makeDatabase().db,
    storage: makeStorage().storage,
    ...(signedOut ? { auth: stubAuth(null) } : {}),
    ...(ui ? { ui } : {}),
    logger: createShelfLogger({ level: "silent" }),
  });
}

describe("web app manifest", () => {
  it("is classified hosting", () => {
    expect(classOfRoute("GET", "/manifest.webmanifest")).toBe("hosting");
  });

  it("describes a standalone app and needs no session", async () => {
    const response = await makeApp(undefined, true).request("/manifest.webmanifest");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/manifest+json");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    const manifest = (await response.json()) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      name: "StoryShelf",
      short_name: "StoryShelf",
      start_url: "/",
      scope: "/",
      display: "standalone",
      theme_color: LIGHT_THEME.surface.base,
      background_color: LIGHT_THEME.surface.base,
    });
    expect(manifest["icons"]).toEqual([
      { src: assetManifest.mark.href, sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: assetManifest.mark.href, sizes: "512x512", type: "image/svg+xml", purpose: "any" },
      {
        src: assetManifest.maskable.href,
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ]);
  });

  it("follows a configured name", async () => {
    const manifest = (await (
      await makeApp({ name: "Acme" }).request("/manifest.webmanifest")
    ).json()) as Record<string, unknown>;
    expect(manifest["name"]).toBe("Acme");
  });

  it("serves the maskable icon as immutable SVG", async () => {
    const response = await makeApp().request(assetManifest.maskable.href);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(await response.text()).toContain("scale(0.7)");
  });
});

describe("document head", () => {
  it("links the manifest and sets light and dark theme-color", async () => {
    const html = await (await makeApp().request("/projects")).text();
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"/>');
    expect(html).toContain(
      `<meta name="theme-color" content="${LIGHT_THEME.surface.base}" media="(prefers-color-scheme: light)"/>`,
    );
    expect(html).toContain(
      `<meta name="theme-color" content="${DARK_THEME.surface.base}" media="(prefers-color-scheme: dark)"/>`,
    );
  });
});
