import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { Option, OptionList } from "./components.tsx";
import { Style } from "./css.ts";

async function render(node: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", async (c) => {
    return await c.html(
      <html>
        <head>
          <Style />
        </head>
        <body>{node as string}</body>
      </html>,
    );
  });
  return await (await app.request("/")).text();
}

/** The opening tag of the first button in rendered markup (the page also carries its stylesheet). */
function buttonTag(html: string): string {
  return /<button\b[^>]*>/u.exec(html)?.[0] ?? "";
}

describe("OptionList and Option", () => {
  it("names the group, and renders each option as a button that passes its attributes through", async () => {
    const html = await render(
      <OptionList label="Mention a member">
        <Option hx-post="/pick" hx-vals='{"pick":"u1"}'>
          @ana
        </Option>
      </OptionList>,
    );
    expect(html).toContain('role="group" aria-label="Mention a member"');
    const tag = buttonTag(html);
    expect(tag).toContain('type="button"');
    expect(tag).toContain('hx-post="/pick"');
    expect(tag).not.toContain("aria-current");
  });

  it("marks the selected option with aria-current and can disable one", async () => {
    expect(buttonTag(await render(<Option selected>@bo</Option>))).toContain('aria-current="true"');
    const off = buttonTag(await render(<Option disabled>@cy</Option>));
    expect(off).toContain("disabled");
    expect(off).not.toContain("aria-current");
  });
});
