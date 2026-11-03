import type { StoryObj } from "@storybook/html-vite";
import { markSource } from "../src/assets/mark.ts";
import type { Store } from "../src/store.ts";
import { resolveHtml } from "./render.tsx";
import { iconSprite } from "./shims/sprite.ts";
import { setStoryStore } from "./shims/store.ts";

type PageHtml = unknown;

export interface PageStoryOptions {
  /** Store fields for this story (testing off, a signed-in user, …). */
  store?: Partial<Store>;
}

const markDataUri = `data:image/svg+xml,${encodeURIComponent(markSource)}`;

/**
 * Turn a rendered page document into one that stands alone in an iframe: no scripts or other
 * requests (the app's assets are not served here), the icon sprite inline, and the story's theme.
 */
export function standalonePage(html: string, theme: string): string {
  return html
    .replaceAll(/<script\b[^>]*\bsrc=[^>]*><\/script>/gu, "")
    .replaceAll(/<link\b[^>]*\brel="icon"[^>]*>/gu, "")
    .replaceAll("/assets/mark-storybook.svg", markDataUri)
    .replace('data-theme="system"', `data-theme="${theme}"`)
    .replace(/<body(?<attributes>[^>]*)>/u, `<body$<attributes>>${iconSprite}`);
}

/**
 * A page story: the real `renderXPage()` output (its shell, chrome and styles) in a full-size
 * frame, so layout and the 375/768/1280 viewports behave as in the app. Interactivity is off:
 * every state is its own story.
 */
export function pageStory(render: () => PageHtml, options: PageStoryOptions = {}): StoryObj {
  return {
    parameters: { layout: "fullscreen" },
    loaders: [
      async () => {
        setStoryStore(options.store);
        return { html: await resolveHtml(await render()) };
      },
    ],
    render: (_args, context) => {
      const frame = globalThis.document.createElement("iframe");
      frame.title = context.name;
      frame.srcdoc = standalonePage(
        String(context.loaded["html"]),
        String(context.globals["theme"]),
      );
      frame.style.cssText = "display:block;width:100vw;height:100vh;border:0";
      return frame;
    },
  };
}
