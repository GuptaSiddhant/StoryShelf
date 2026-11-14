/** In-page half of story switching (ADR 0052): the document fingerprint, the tidy and the switch. */

import type { Page } from "playwright-core";

/** First line of the runner's ignore-region style element, so a switch can find and remove it. */
export const MASK_MARKER = "/* storyshelf-mask */";

/** Register the document recorder on a page, once; it runs before the page's own scripts. */
export async function installDocumentRecorder(page: Page): Promise<void> {
  await page.addInitScript(inPageDocumentRecorder);
}

/**
 * Runs in the browser before the page's scripts, on every document. At `DOMContentLoaded`, before
 * Storybook has rendered anything, it records the document as served: the attributes of `html` and
 * `body` (Storybook's own `sb-` classes left out), the number of `body` children outside
 * Storybook's roots, the number of style sheets in `head` and of loaded font faces. Each part is
 * something a story can leave behind that a fresh page would not have. It is serialized into the
 * page, so it must stay one self-contained function; `switch-page.test.ts` evaluates it without
 * bindings.
 */
// oxlint-disable-next-line eslint/max-statements, eslint/max-lines-per-function -- must stay one self-contained function (see above)
export function inPageDocumentRecorder(): void {
  type Fingerprint = {
    html: Record<string, string>;
    body: Record<string, string>;
    extra: number;
    head: number;
    fonts: number;
  };
  const scope = globalThis as unknown as Record<string, unknown> & {
    document?: Document;
    location?: { origin: string };
  };
  if (scope["__STORYSHELF_DOCUMENT__"]) return;
  const marker = "/* storyshelf-mask */";
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page, so it must stay inside
  const attributesOf = (element: Element | null | undefined): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const attribute of Array.from(element?.attributes ?? [])) {
      out[attribute.name] =
        attribute.name === "class"
          ? attribute.value
              .split(/\s+/u)
              .filter((name) => name !== "" && !name.startsWith("sb-"))
              .toSorted()
              .join(" ")
          : attribute.value;
    }
    if (out["class"] === "") delete out["class"];
    return out;
  };
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page, so it must stay inside
  const storybookOwned = (element: Element): boolean =>
    element.tagName === "SCRIPT" ||
    element.id.startsWith("storybook-") ||
    Array.from(element.classList).some((name) => name.startsWith("sb-"));
  const isMask = (element: Element): boolean =>
    element.tagName === "STYLE" && (element.textContent ?? "").startsWith(marker);
  // Preload hints fetch, they do not style: a lazily imported story file adds them.
  const styles = (element: Element): boolean =>
    (element.tagName === "STYLE" && !isMask(element)) ||
    (element.tagName === "LINK" &&
      !["modulepreload", "preload", "prefetch"].includes(element.getAttribute("rel") ?? ""));
  const take = (): Fingerprint => {
    const doc = scope.document;
    return {
      html: attributesOf(doc?.documentElement),
      body: attributesOf(doc?.body),
      extra: Array.from(doc?.body?.children ?? []).filter((element) => !storybookOwned(element))
        .length,
      head: Array.from(doc?.head?.children ?? []).filter((element) => styles(element)).length,
      fonts: doc?.fonts?.size ?? 0,
    };
  };
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page, so it must stay inside
  const restore = (element: Element | null | undefined, want: Record<string, string>): void => {
    if (!element) return;
    const own = Array.from(element.classList).filter((name) => name.startsWith("sb-"));
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name !== "class" && !(attribute.name in want))
        element.removeAttribute(attribute.name);
    }
    for (const [name, value] of Object.entries(want)) {
      if (name !== "class" && element.getAttribute(name) !== value)
        element.setAttribute(name, value);
    }
    const classes = [...own, ...(want["class"] ? want["class"].split(" ") : [])].join(" ");
    if ((element.getAttribute("class") ?? "") === classes) return;
    if (classes === "") element.removeAttribute("class");
    else element.setAttribute("class", classes);
  };
  const state = {
    initial: null as Fingerprint | null,
    take,
    restore: (): void => {
      if (!state.initial) return;
      restore(scope.document?.documentElement, state.initial.html);
      restore(scope.document?.body, state.initial.body);
    },
    marker,
  };
  scope["__STORYSHELF_DOCUMENT__"] = state;
  scope.document?.addEventListener("DOMContentLoaded", () => {
    state.initial = take();
  });
}

/** Where a tidied document still differs from the one served; null when it matches. */
export type DocumentDrift = "unrecorded" | "attributes" | "body" | "head" | "fonts";

/**
 * Runs in the browser after a screenshot, before the next switch: removes the runner's mask
 * style, scrolls to the top, drops focus and selection, puts the attributes of `html` and `body`
 * back as served (a decorator sets its own again on the next render), then compares the document
 * with the one recorded at `DOMContentLoaded`. Self-contained for the same reason as the recorder.
 */
// oxlint-disable-next-line eslint/max-statements -- must stay one self-contained function (see above)
export function inPageTidy(): DocumentDrift | null {
  type Fingerprint = {
    html: Record<string, string>;
    body: Record<string, string>;
    extra: number;
    head: number;
    fonts: number;
  };
  type Recorder = {
    initial: Fingerprint | null;
    take: () => Fingerprint;
    restore: () => void;
    marker: string;
  };
  const scope = globalThis as unknown as Record<string, unknown> & {
    document?: Document;
    scrollTo?: (x: number, y: number) => void;
    getSelection?: () => { removeAllRanges(): void } | null;
  };
  const recorder = scope["__STORYSHELF_DOCUMENT__"] as Recorder | undefined;
  if (!recorder?.initial) return "unrecorded";
  for (const style of Array.from(scope.document?.querySelectorAll("style") ?? [])) {
    if ((style.textContent ?? "").startsWith(recorder.marker)) style.remove();
  }
  scope.scrollTo?.(0, 0);
  (scope.document?.activeElement as { blur?: () => void } | null | undefined)?.blur?.();
  scope.getSelection?.()?.removeAllRanges();
  recorder.restore();
  const now = recorder.take();
  const was = recorder.initial;
  if (JSON.stringify(now.html) !== JSON.stringify(was.html)) return "attributes";
  if (JSON.stringify(now.body) !== JSON.stringify(was.body)) return "attributes";
  if (now.extra !== was.extra) return "body";
  if (now.head !== was.head) return "head";
  return now.fonts === was.fonts ? null : "fonts";
}

/**
 * Runs in the browser: point the settle recorder at `storyId` and ask Storybook to render it
 * (`setCurrentStory`, the event the manager sends). From here only that story's events settle the
 * page. False when the page has no recorder or no channel to switch with.
 */
// oxlint-disable-next-line eslint/max-statements -- must stay one self-contained function (see the recorder)
export function inPageSwitch(storyId: string): boolean {
  type State = {
    settled: boolean;
    finished: boolean;
    phase: string | null;
    unhandled: string[];
    expect: string | null;
    renderError?: string;
    playError?: string;
  };
  type Channel = { emit: (event: string, payload: unknown) => void };
  const scope = globalThis as unknown as Record<string, unknown>;
  const state = scope["__STORYSHELF_SETTLE__"] as State | undefined;
  const channel = (scope["__STORYBOOK_ADDONS_CHANNEL__"] ??
    (scope["__STORYBOOK_PREVIEW__"] as { channel?: unknown } | undefined)?.channel) as
    | Channel
    | undefined;
  if (!state || typeof channel?.emit !== "function") return false;
  state.settled = false;
  state.finished = false;
  state.phase = null;
  state.unhandled = [];
  delete state.renderError;
  delete state.playError;
  state.expect = storyId;
  channel.emit("setCurrentStory", { storyId, viewMode: "story" });
  return true;
}

/** Runs in the browser: every font face the document wants has loaded, bounded by `timeoutMs`. */
export async function inPageFontsReady(timeoutMs: number): Promise<void> {
  const scope = globalThis as unknown as { document: { fonts?: { ready: Promise<unknown> } } };
  await Promise.race([
    scope.document.fonts?.ready,
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}
