import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { clientScript } from "../shell/client-script.ts";
import { PREVIEW_SANDBOX, PreviewEmbed } from "./preview-embed.tsx";

async function render(refresh?: { url: string; path: string; seconds: number }): Promise<string> {
  const app = new Hono();
  app.get(
    "/",
    async (c) =>
      await c.html(
        <PreviewEmbed
          src="/projects/p/storybook/build/b/iframe.html?id=a--b"
          title="A / B"
          {...(refresh ? { refresh } : {})}
        />,
      ),
  );
  return await (await app.request("/")).text();
}

const SIGNED = { url: "/tok", path: "/iframe.html?id=a--b", seconds: 2400 };

describe("PreviewEmbed", () => {
  it("sandboxes the frame without same-origin access, top navigation, forms or popups", async () => {
    expect(PREVIEW_SANDBOX).toBe("allow-scripts");
    const html = await render();
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-same-origin");
    expect(html).not.toMatch(/allow-(?:top-navigation|forms|popups|modals)/u);
    expect(html).toContain('referrerpolicy="no-referrer"');
  });

  it("keeps the frame inert inside a template until the visitor clicks", async () => {
    const html = await render();
    const outside = html.replace(/<template[\s\S]*<\/template>/u, "");
    expect(outside).not.toContain("<iframe");
    expect(outside).not.toContain("iframe.html");
    expect(html).toMatch(/<template data-preview-template[^>]*>\s*<iframe/u);
    expect(html).toContain("data-preview-load");
  });

  it("is wired to a delegated click handler in the shell script", () => {
    const script = clientScript();
    expect(script).toContain("data-preview-load");
    expect(script).toContain("template[data-preview-template]");
  });
});

describe("PreviewEmbed under a signed URL", () => {
  it("says under a signed preview that it reloads itself, in whole minutes", async () => {
    const html = await render(SIGNED);
    expect(html).toContain("Signed preview: it reloads itself every 40 minutes to stay signed in.");
    expect(html).toMatch(/<div role="status" aria-live="polite">/u);
    expect((await render({ ...SIGNED, seconds: 90 })).includes("every 2 minutes")).toBe(true);
    expect((await render({ ...SIGNED, seconds: 20 })).includes("every minute to stay")).toBe(true);
  });

  it("renders the renewal notice hidden, with a reload button outside the box", async () => {
    const html = await render(SIGNED);
    expect(html).toMatch(/<div data-preview-notice="true" hidden="">/u);
    expect(html).toContain("Preview couldn&#39;t be renewed");
    expect(html).toContain("Reload preview");
    expect(html).toMatch(/<span data-preview-again="true" hidden="">/u);
    const box = /<div[^>]*data-preview-embed[\s\S]*?<\/template><\/div>/u.exec(html)?.[0] ?? "";
    expect(box).not.toContain("data-preview-reload");
    expect(box).not.toContain("data-preview-notice");
    expect(html).not.toContain('role="alert"');
    // One live region only: the notice's Alert adds none inside the region the notes sit in.
    expect(html.match(/role="status"/gu)).toHaveLength(1);
  });

  it("says nothing about renewing under an unsigned preview", async () => {
    const html = await render();
    expect(html).not.toContain("data-preview-disclosure");
    expect(html).not.toContain("data-preview-notice");
    expect(html).not.toContain("reloads itself");
  });

  it("keeps the sandbox of a signed preview as it is", async () => {
    const html = await render(SIGNED);
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-same-origin");
  });
});
