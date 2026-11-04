// oxlint-disable typescript/promise-function-async -- helpers return Hono JSX (a Promise<HtmlEscapedString>)
import { describe, expect, it } from "vitest";
import { PreviewEmbed } from "../src/ui/components.tsx";
import { previewState } from "./preview-state.ts";
import { renderJsx } from "./render.tsx";

const signed = async (): Promise<string> =>
  await renderJsx(
    <PreviewEmbed
      src="about:blank"
      title="Kit / Button"
      refresh={{ url: "/tok", path: "/iframe.html?id=a", seconds: 2400 }}
    />,
  );

/** The opening tag of the element with the marker. */
function tagOf(html: string, marker: string): string {
  return new RegExp(`<[a-z]+\\b[^>]*\\s${marker}="true"[^>]*>`, "u").exec(html)?.[0] ?? "";
}

describe("previewState", () => {
  it("leaves the healthy default and an unsigned preview alone", async () => {
    const html = await signed();
    expect(previewState(html)).toBe(html);
    const unsigned = await renderJsx(<PreviewEmbed src="about:blank" title="t" />);
    expect(previewState(unsigned, "failed")).toBe(unsigned);
  });

  it("shows the notice and hides the disclosure line when the renewal failed", async () => {
    const html = previewState(await signed(), "failed");
    expect(tagOf(html, "data-preview-notice")).not.toContain("hidden");
    expect(tagOf(html, "data-preview-disclosure")).toContain('hidden=""');
    expect(tagOf(html, "data-preview-again")).toContain('hidden=""');
    expect(tagOf(html, "data-preview-reload")).not.toContain("disabled");
  });

  it("shows the reload in flight: a busy notice and a disabled, relabelled button", async () => {
    const html = previewState(await signed(), "reloading");
    expect(tagOf(html, "data-preview-notice")).toContain('aria-busy="true"');
    expect(tagOf(html, "data-preview-reload")).toContain('disabled=""');
    expect(html).toContain("Reloading…");
    expect(html).not.toContain(">Reload preview<");
  });

  it("shows the second failure line and keeps the button usable", async () => {
    const html = previewState(await signed(), "failed-again");
    expect(tagOf(html, "data-preview-again")).not.toContain("hidden");
    expect(tagOf(html, "data-preview-notice")).not.toContain("aria-busy");
    expect(tagOf(html, "data-preview-reload")).not.toContain("disabled");
  });
});
