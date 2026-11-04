import type { StoryObj } from "@storybook/html-vite";
import { markSource } from "../src/assets/mark.ts";
import { clientScript } from "../src/shell/client-script.ts";
import type { Store } from "../src/store.ts";
import type { StoryDataset } from "../src/stories-fixtures/database.ts";
import { baselineShot, currentShot, designShot, diffShot } from "./assets/screens.ts";
import { resolveHtml, withFrozenClock } from "./render.tsx";
import { forgetStoredChoices } from "./review-client.ts";
import { iconSprite } from "./shims/sprite.ts";
import { setStoryStore, useStoryDataset } from "./shims/store.ts";
import { type StageState, stageState } from "./stage-state.ts";

type PageHtml = unknown;

export interface PageStoryOptions {
  /** Store fields for this story (testing off, a signed-in user, …). */
  store?: Partial<Store>;
  /** The data the page reads: the populated project (default), an empty one, or none at all. */
  dataset?: StoryDataset;
  /** Show the review comparison stage in this mode, zoom or flip side (default: split, fit). */
  stage?: StageState;
  /**
   * Run the shell's own client script inside the page frame for this story only, so the comparison
   * controls work. Every other page story stays a fixed state.
   */
  interactive?: boolean;
}

/** The fixed screenshots standing in for a snapshot's image, diff and baseline URLs. */
const SCREENSHOTS: Record<string, string> = {
  image: currentShot,
  diff: diffShot,
  baseline: baselineShot,
};

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
    .replaceAll(
      /src="\/api\/v1\/[^"]*\/(?<kind>image|diff|baseline)"/gu,
      (_match, kind: string) => `src="${SCREENSHOTS[kind] ?? currentShot}"`,
    )
    .replaceAll(/src="\/api\/v1\/[^"]*"/gu, `src="${designShot}"`)
    .replace('data-theme="system"', `data-theme="${theme}"`)
    .replace(/<body(?<attributes>[^>]*)>/u, `<body$<attributes>>${iconSprite}`);
}

/** Put the page's own client script back at the end of its body, where the document has it. */
function withClientScript(html: string): string {
  return html.replace("</body>", () => `<script>${clientScript()}</script></body>`);
}

/** The same story in the preview's 375px phone viewport (`viewport.options.phone` in `preview.ts`). */
export function onAPhone(story: StoryObj): StoryObj {
  return { ...story, globals: { viewport: { value: "phone", isRotated: false } } };
}

/**
 * A page story: the real `renderXPage()` output (its shell, chrome and styles) in a full-size
 * frame, so layout and the 375/768/1280 viewports behave as in the app. Interactivity is off
 * (every state is its own story) unless a story opts in with `interactive`.
 */
export function pageStory(render: () => PageHtml, options: PageStoryOptions = {}): StoryObj {
  return {
    parameters: { layout: "fullscreen" },
    loaders: [
      async () => ({
        html: await withFrozenClock(async () => {
          setStoryStore(options.store);
          await useStoryDataset(options.dataset ?? "populated");
          return stageState(await resolveHtml(await render()), options.stage);
        }),
      }),
    ],
    render: (_args, context) => {
      const frame = globalThis.document.createElement("iframe");
      frame.title = context.name;
      const page = standalonePage(String(context.loaded["html"]), String(context.globals["theme"]));
      if (options.interactive) {
        forgetStoredChoices();
      }
      frame.srcdoc = options.interactive ? withClientScript(page) : page;
      frame.style.cssText = "display:block;width:100vw;height:100vh;border:0";
      return frame;
    },
  };
}
