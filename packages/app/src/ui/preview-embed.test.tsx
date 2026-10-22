import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { PREVIEW_SANDBOX, PreviewEmbed } from "./preview-embed.tsx";
import { clientScript } from "./shell/client-script.ts";

async function render(): Promise<string> {
  const app = new Hono();
  app.get(
    "/",
    async (c) =>
      await c.html(
        <PreviewEmbed src="/projects/p/storybook/build/b/iframe.html?id=a--b" title="A / B" />,
      ),
  );
  return await (await app.request("/")).text();
}

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
