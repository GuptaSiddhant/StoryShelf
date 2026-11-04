import type { StoryObj } from "@storybook/html-vite";
import { Fragment } from "hono/jsx";
import { HtmlEscapedCallbackPhase, resolveCallback } from "hono/utils/html";
import { Style } from "../src/ui/css.ts";
import { loadReviewClient } from "./review-client.ts";
import { type StageState, stageState } from "./stage-state.ts";

/** The fixed "now" of every story: relative times ("3 d ago") and dates never change. */
export const STORY_NOW = "2026-01-15T12:00:00.000Z";

/**
 * Run a render with the clock frozen at `STORY_NOW` and dates formatted as `en-US` in UTC, so the
 * HTML is the same on every machine and every day (stories become baselines).
 */
export async function withFrozenClock<T>(render: () => Promise<T>): Promise<T> {
  const turn = queue.then(async () => await frozen(render));
  queue = turn.catch(() => null);
  return await turn;
}

/** Story renders run one at a time: they share the frozen clock and the story store. */
let queue: Promise<unknown> = Promise.resolve();

async function frozen<T>(render: () => Promise<T>): Promise<T> {
  const RealDate = globalThis.Date;
  const now = RealDate.parse(STORY_NOW);
  class FrozenDate extends RealDate {
    constructor(...args: unknown[]) {
      super(...((args.length === 0 ? [now] : args) as [number]));
    }
    static override now(): number {
      return now;
    }
    override toLocaleString(): string {
      return super.toLocaleString("en-US", { timeZone: "UTC" });
    }
    override toLocaleDateString(): string {
      return super.toLocaleDateString("en-US", { timeZone: "UTC" });
    }
    override toLocaleTimeString(): string {
      return super.toLocaleTimeString("en-US", { timeZone: "UTC" });
    }
  }
  globalThis.Date = FrozenDate as unknown as DateConstructor;
  try {
    return await render();
  } finally {
    globalThis.Date = RealDate;
  }
}

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

export interface JsxStoryOptions {
  /** Show popover menus (native `<details>`) open, so their items can be seen without clicking. */
  open?: boolean;
  /** Show a comparison stage in this mode, zoom or flip side (default: split, fit). */
  stage?: StageState;
  /**
   * Load the shell's own client script for this story only, so the comparison controls work. Every
   * other story stays a fixed state (and a capturable baseline).
   */
  interactive?: boolean;
}

/** Story-only: mark every `<details>` open in already-rendered HTML (no production change). */
function openDetails(html: string): string {
  return html.replaceAll("<details ", "<details open ");
}

/**
 * A story from a JSX factory. Components are async, so the render runs in a `loaders` step and
 * the story returns the finished HTML (`loaded.html`).
 */
export function jsxStory(factory: () => unknown, options: JsxStoryOptions = {}): StoryObj {
  const finish = options.open ? openDetails : (html: string): string => html;
  const story: StoryObj = {
    loaders: [
      async () => ({
        html: stageState(
          finish(await withFrozenClock(async () => await renderJsx(factory()))),
          options.stage,
        ),
      }),
    ],
    render: (_args, context) => String(context.loaded["html"]),
  };
  if (options.interactive) {
    story.play = ({ canvasElement }): void => {
      loadReviewClient(canvasElement);
    };
  }
  return story;
}
