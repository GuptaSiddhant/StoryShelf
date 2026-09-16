import type { Viewport } from "./adapter.ts";

/** Padding around the cropped component (8px each side). */
const PAD = 16;
const HALF_PAD = 8;

/** Default min/max dimensions for cropped/fullPage screenshots (diff stability). */
export const SIZING_DEFAULTS = {
  minWidth: 100,
  minHeight: 100,
  maxWidth: 2000,
  maxHeight: 4000,
  whitespaceThreshold: 0.6,
} as const;

/** Bounding box of #storybook-root as returned by Playwright/Puppeteer. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Options for computing the screenshot plan. */
export interface SizingOptions {
  /** Per-story override: false forces full viewport, true forces crop when possible. */
  autoCrop?: boolean;
  /** Whitespace fraction (0..1) above which we crop; default 0.6. */
  whitespaceThreshold?: number;
  /** Whether overflow should trigger fullPage; default true. */
  fullPageOnOverflow?: boolean;
  /** Min dimensions for the final PNG (clamp after padding). */
  minWidth?: number;
  minHeight?: number;
  /** Max dimensions for the final PNG (clamp after padding). */
  maxWidth?: number;
  maxHeight?: number;
}

/** Result of the sizing decision — what the runner should do. */
export interface ScreenshotPlan {
  /** Viewport to set on the page before capture. */
  viewport: Viewport;
  /** Clip to use for page.screenshot({clip}). Undefined means full viewport. */
  clip?: { x: number; y: number; width: number; height: number };
  /** Whether to use fullPage screenshot (for overflow). */
  fullPage: boolean;
}

/** Clamp value between min and max. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isOverflowing(box: BoundingBox, viewport: Viewport): boolean {
  return box.width > viewport.width || box.height > viewport.height;
}

function whitespaceOf(box: BoundingBox, viewport: Viewport): number {
  const viewportArea = viewport.width * viewport.height;
  const boxArea = box.width * box.height;
  const coverage = viewportArea > 0 ? boxArea / viewportArea : 1;
  return 1 - Math.min(coverage, 1);
}

function shouldCrop(
  box: BoundingBox,
  viewport: Viewport,
  opts: SizingOptions,
  threshold: number,
): boolean {
  if (opts.autoCrop === true) return true;
  return whitespaceOf(box, viewport) > threshold;
}

function paddedClip(
  box: BoundingBox,
  minW: number,
  maxW: number,
  minH: number,
  maxH: number,
): BoundingBox {
  const w = clamp(Math.ceil(box.width + PAD), minW, maxW);
  const h = clamp(Math.ceil(box.height + PAD), minH, maxH);
  return {
    x: Math.max(0, box.x - HALF_PAD),
    y: Math.max(0, box.y - HALF_PAD),
    width: w,
    height: h,
  };
}

/**
 * Compute the screenshot plan for a single story×viewport.
 * Single prod owner for sizing logic — runners import this, never duplicate.
 */
export function getScreenshotPlan(
  viewport: Viewport,
  box: BoundingBox | null,
  options: SizingOptions = {},
): ScreenshotPlan {
  if (options.autoCrop === false) return { viewport, fullPage: false };
  if (!box) return { viewport, fullPage: false };
  if (isOverflowing(box, viewport) && (options.fullPageOnOverflow ?? true)) {
    return { viewport, fullPage: true };
  }
  if (isOverflowing(box, viewport)) {
    return grownViewportPlan(viewport, box, options);
  }
  return maybeCroppedPlan(viewport, box, options);
}

function grownViewportPlan(
  viewport: Viewport,
  box: BoundingBox,
  options: SizingOptions,
): ScreenshotPlan {
  const maxH = options.maxHeight ?? SIZING_DEFAULTS.maxHeight;
  const grownHeight = clamp(Math.ceil(box.height + PAD), viewport.height, maxH);
  return { viewport: { ...viewport, height: grownHeight }, fullPage: false };
}

function maybeCroppedPlan(
  viewport: Viewport,
  box: BoundingBox,
  options: SizingOptions,
): ScreenshotPlan {
  const threshold = options.whitespaceThreshold ?? SIZING_DEFAULTS.whitespaceThreshold;
  if (!shouldCrop(box, viewport, options, threshold)) return { viewport, fullPage: false };
  const minW = options.minWidth ?? SIZING_DEFAULTS.minWidth;
  const minH = options.minHeight ?? SIZING_DEFAULTS.minHeight;
  const maxW = options.maxWidth ?? SIZING_DEFAULTS.maxWidth;
  const maxH = options.maxHeight ?? SIZING_DEFAULTS.maxHeight;
  const clip = paddedClip(box, minW, maxW, minH, maxH);
  return {
    viewport,
    clip: { x: Math.round(clip.x), y: Math.round(clip.y), width: clip.width, height: clip.height },
    fullPage: false,
  };
}

/** Resolve viewports from project/server config with fallback to default (not sizing, just list). */
export function resolveViewports(
  rawViewports: string | null | undefined,
  fallback: Viewport[],
  serverViewports?: Viewport[],
): Viewport[] {
  if (serverViewports && serverViewports.length > 0) return serverViewports;
  if (rawViewports) return parsedViewports(rawViewports) ?? fallback;
  return fallback;
}

function parsedViewports(raw: string): Viewport[] | null {
  try {
    const parsed = JSON.parse(raw) as Viewport[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // fallback
  }
  return null;
}
