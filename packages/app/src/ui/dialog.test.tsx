import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { Dialog, DialogLink } from "./dialog.tsx";

async function render(node: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html(node as never));
  return await (await app.request("/")).text();
}

describe("Dialog", () => {
  it("is a named native dialog with an accessible close button", async () => {
    const html = await render(
      <Dialog id="d" title="Edit" closeLabel="Close dialog" footer={<b>Save</b>}>
        body
      </Dialog>,
    );
    expect(html).toContain("<dialog");
    expect(html).toContain('aria-labelledby="d-title"');
    expect(html).toContain('aria-label="Close dialog"');
    expect(html).toContain('id="d-body"');
    expect(html).toContain("<b>Save</b>");
  });

  it("omits the footer when none is given", async () => {
    expect(
      await render(
        <Dialog id="d" title="Edit">
          x
        </Dialog>,
      ),
    ).not.toContain("dialog-footer");
  });
});

describe("DialogLink", () => {
  it("is a real link that HTMX loads into the dialog body", async () => {
    const html = await render(
      <DialogLink dialogId="d" href="/x/edit">
        Edit
      </DialogLink>,
    );
    expect(html).toContain('href="/x/edit"');
    expect(html).toContain('hx-get="/x/edit"');
    expect(html).toContain('hx-target="#d-body"');
    expect(html).toContain('data-dialog-open="d"');
  });
});
