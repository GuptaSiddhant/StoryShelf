/** Bounded, opt-in DOM evidence for an isolated investigation replay page. */
import type { Page } from "playwright-core";

export interface ReplayDomNode {
  path: string;
  tag: string;
  id?: string;
  attributes: Record<string, string>;
  style: Record<string, string>;
  bounds: { x: number; y: number; width: number; height: number } | null;
}
export interface ReplayDomEvidence {
  nodes: ReplayDomNode[];
  truncated: boolean;
  coverage: string[];
}

export const REPLAY_MAX_NODES = 20_000;
export const REPLAY_MAX_DEPTH = 64;
export const REPLAY_MAX_BYTES = 2 * 1024 * 1024;
export const REPLAY_DOM_TIMEOUT_MS = 30_000;

/** The caller owns the page and must close its context if this operation times out. */
export async function collectReplayDom(page: Page): Promise<ReplayDomEvidence> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Replay DOM collection timed out"));
    }, REPLAY_DOM_TIMEOUT_MS);
    timer.unref?.();
  });
  try {
    return await Promise.race([
      page.evaluate(inPageCollect, {
        maxNodes: REPLAY_MAX_NODES,
        maxDepth: REPLAY_MAX_DEPTH,
        maxBytes: REPLAY_MAX_BYTES,
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs only in the replay page after capture-equivalent settling. */
// oxlint-disable-next-line eslint/max-lines-per-function -- serialized browser callback must be self-contained
function inPageCollect(limits: {
  maxNodes: number;
  maxDepth: number;
  maxBytes: number;
}): ReplayDomEvidence {
  const attributes = [
    "id",
    "class",
    "role",
    "aria-label",
    "aria-expanded",
    "aria-selected",
    "title",
    "type",
  ];
  const styles = [
    "display",
    "visibility",
    "opacity",
    "position",
    "width",
    "height",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "borderTopColor",
    "borderRightColor",
    "borderBottomColor",
    "borderLeftColor",
    "color",
    "backgroundColor",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "whiteSpace",
    "transform",
  ];
  const nodes: ReplayDomNode[] = [];
  const coverage = [
    "light DOM elements only",
    "text and form values excluded",
    "shadow DOM, canvas internals and cross-origin frames excluded",
  ];
  const encoder = new TextEncoder();
  let bytes = 2;
  let truncated = false;
  // oxlint-disable-next-line eslint/max-statements -- bounded walk checks are deliberately colocated
  const visit = (element: Element, path: string, depth: number): void => {
    if (truncated) return;
    if (nodes.length >= limits.maxNodes || depth > limits.maxDepth) {
      truncated = true;
      return;
    }
    const tag = element.tagName.toLowerCase();
    if (
      tag === "script" ||
      tag === "style" ||
      (tag === "input" && element.getAttribute("type") === "hidden")
    )
      return;
    const selected: Record<string, string> = {};
    for (const name of attributes) {
      const value = element.getAttribute(name);
      if (value !== null && value.length <= 256) selected[name] = value;
    }
    const computed = globalThis.getComputedStyle(element);
    const style: Record<string, string> = {};
    for (const name of styles) {
      const value = computed[name as keyof CSSStyleDeclaration];
      if (typeof value === "string") style[name] = value.slice(0, 256);
    }
    const box = element.getBoundingClientRect();
    const node: ReplayDomNode = {
      path,
      tag,
      ...(selected["id"] ? { id: selected["id"] } : {}),
      attributes: selected,
      style,
      bounds: { x: box.x, y: box.y, width: box.width, height: box.height },
    };
    const size = encoder.encode(JSON.stringify(node)).byteLength + 1;
    if (bytes + size > limits.maxBytes) {
      truncated = true;
      return;
    }
    bytes += size;
    nodes.push(node);
    let index = 0;
    for (const child of element.children) {
      visit(child, `${path}/${index}`, depth + 1);
      index += 1;
    }
  };
  if (globalThis.document.documentElement) visit(globalThis.document.documentElement, "0", 0);
  return { nodes, truncated, coverage };
}
