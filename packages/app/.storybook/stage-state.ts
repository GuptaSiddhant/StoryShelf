/**
 * Story-only: put an already-rendered comparison stage in a given mode, zoom or flip side, so each
 * view is a deterministic story (a baseline) without the shell's client script clicking the
 * controls. It edits the rendered HTML only: `CompareStage` keeps rendering the default view
 * (split, fit) and nothing in production changes.
 */
export interface StageState {
  view?: "split" | "swipe" | "onion" | "diff" | "flip";
  zoom?: "fit" | "100" | "200" | "400";
  /** Which image a flip stage shows (`current` is the default). */
  flip?: "current" | "baseline";
}

/** The opening tag of a stage root: `data-compare` as its own attribute, not `data-compare-mode`. */
const STAGE_ROOT = /<div\b[^>]*\sdata-compare(?=[\s=>])[^>]*>/gu;

/** A segmented control group and the pressed state of its buttons. */
const GROUPS = {
  view: /(?<open><div\b[^>]*\sdata-compare-mode(?=[\s=>])[^>]*>)(?<inner>[\s\S]*?)(?<close><\/div>)/gu,
  zoom: /(?<open><div\b[^>]*\sdata-compare-zoom(?=[\s=>])[^>]*>)(?<inner>[\s\S]*?)(?<close><\/div>)/gu,
} as const;

const PRESSED_BUTTON =
  /(?<head><button\b[^>]*\sdata-view-value=")(?<value>[^"]+)(?<tail>"[^>]*\saria-pressed=")(?:true|false)(?<end>")/gu;

/** `data-modes="a,b"` / `data-zooms="a"` on a stage root: what that stage allows (absent: all). */
function allows(tag: string, list: "data-modes" | "data-zooms", value: string): boolean {
  const match = new RegExp(`\\s${list}="(?<values>[^"]*)"`, "u").exec(tag);
  return match?.groups?.["values"]?.split(",").includes(value) ?? true;
}

function setAttribute(tag: string, name: string, value: string): string {
  return tag.replace(new RegExp(`(?<name>\\s${name}=")[^"]*"`, "u"), `$<name>${value}"`);
}

/** Set the stage root attributes the state asks for, where that stage allows them. */
function retag(html: string, state: StageState): string {
  return html.replaceAll(STAGE_ROOT, (tag) => {
    let next = tag;
    if (state.view && allows(tag, "data-modes", state.view)) {
      next = setAttribute(next, "data-view", state.view);
    }
    if (state.zoom && allows(tag, "data-zooms", state.zoom)) {
      next = setAttribute(next, "data-zoom", state.zoom);
    }
    return state.flip ? setAttribute(next, "data-flip", state.flip) : next;
  });
}

/** Mark `value` as the pressed button of every control group that offers it. */
function press(html: string, group: keyof typeof GROUPS, value: string): string {
  return html.replaceAll(GROUPS[group], (match, ...rest: unknown[]) => {
    const groups = rest.at(-1) as { open: string; inner: string; close: string };
    if (!groups.inner.includes(`data-view-value="${value}"`)) {
      return match;
    }
    const inner = groups.inner.replaceAll(
      PRESSED_BUTTON,
      (_button, _head, current: string, ...more: unknown[]) => {
        const parts = more.at(-1) as { head: string; tail: string; end: string };
        return `${parts.head}${current}${parts.tail}${current === value ? "true" : "false"}${parts.end}`;
      },
    );
    return `${groups.open}${inner}${groups.close}`;
  });
}

/** Show every comparison stage in `html` in the given state (a stage that lacks it is unchanged). */
export function stageState(html: string, state?: StageState): string {
  if (!state) {
    return html;
  }
  let next = retag(html, state);
  if (state.view) {
    next = press(next, "view", state.view);
  }
  if (state.zoom) {
    next = press(next, "zoom", state.zoom);
  }
  return next;
}
