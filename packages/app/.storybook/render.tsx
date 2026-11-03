import type { StoryObj } from "@storybook/html-vite";
import { Fragment } from "hono/jsx";
import { HtmlEscapedCallbackPhase, resolveCallback } from "hono/utils/html";
import { Style } from "../src/ui/css.ts";

/**
 * Resolve rendered hono/jsx (a node, or a promise of one) to an HTML string, as `c.html()` does:
 * async components are awaited and `<Style />` is filled with the `hono/css` classes collected from
 * exactly what was rendered, so a story is styled like production.
 */
export async function resolveHtml(node: unknown): Promise<string> {
  const rendered = await (node as { toString(): string | Promise<string> }).toString();
  const html = await resolveCallback(rendered, HtmlEscapedCallbackPhase.Stringify, false, {});
  return html;
}

/** Render a fragment of components, with its own `<Style />`. */
export async function renderJsx(node: unknown): Promise<string> {
  return await resolveHtml(
    <Fragment>
      <Style />
      {node as string}
    </Fragment>,
  );
}

/**
 * A story from a JSX factory. Components are async, so the render runs in a `loaders` step and
 * the story returns the finished HTML (`loaded.html`).
 */
export function jsxStory(factory: () => unknown): StoryObj {
  return {
    loaders: [async () => ({ html: await renderJsx(factory()) })],
    render: (_args, context) => String(context.loaded["html"]),
  };
}
