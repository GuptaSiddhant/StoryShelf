import type { FC } from "hono/jsx";
import { css } from "./css.ts";
import { Segmented } from "./segmented.tsx";
/**
 * Screenshot comparison surface. All modes share one set of images; the
 * `data-view` / `data-zoom` / `data-flip` attributes on the root (driven by
 * the review script) decide what is shown. Without JS it stays side-by-side.
 */
const stageRoot = css`
  /* compare-stage */
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  min-width: 0;
  .stage__bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
  }
  /* On a phone the five modes are wider than the card: the switch scrolls instead of widening the stage. */
  .stage__bar > * {
    max-width: 100%;
    overflow-x: auto;
  }
  /* Two columns: baseline and current. The diff is a mode (one column), never a third column. */
  .stage__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    align-items: start;
  }
  .stage__pane {
    position: relative;
    min-width: 0;
    max-height: 78vh;
    overflow: auto;
    background: var(--surface-muted);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
  }
  .stage__canvas {
    padding: var(--space-2);
  }
  .stage__pane:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  /*
   * Swipe and onion stack the panes in one cell, and the current pane is clipped (swipe) or faded
   * (onion), which clips or fades its own outline away. The ring goes on the grid, which neither touches.
   */
  &[data-view="swipe"] .stage__grid:has(.stage__pane:focus-visible),
  &[data-view="onion"] .stage__grid:has(.stage__pane:focus-visible) {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
    border-radius: var(--radius);
  }
  .stage__label {
    position: sticky;
    top: 0;
    left: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.35rem 0.6rem;
    background: var(--surface-subtle);
    border-bottom: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  /*
   * Fit never upscales: an image is at most its natural width. Two images with known sizes are each
   * an SVG whose viewBox is as wide as the wider image, so both shrink by the same factor
   * (min(1, pane width / wider width)) and a 100 px square stays smaller than a 120 px one.
   */
  .stage__img {
    display: block;
    max-width: 100%;
    height: auto;
    outline: 1px solid var(--border-subtle);
  }
  .stage__img[data-scaled] {
    overflow: visible;
    outline: none;
  }
  .stage__outline {
    fill: none;
    stroke: var(--border-subtle);
    vector-effect: non-scaling-stroke;
  }
  .stage__empty {
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 9;
    padding: var(--space-4);
    background: var(--surface-subtle);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    text-align: center;
  }
  .stage__note {
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  .stage__divider,
  .stage__controls {
    display: none;
  }
  .stage__controls {
    align-items: center;
    gap: var(--space-3);
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  .stage__controls input {
    flex: 1;
    accent-color: var(--accent);
  }
  &[data-zoom="100"] .stage__img {
    width: auto;
    max-width: none;
  }
  &[data-zoom="200"] .stage__img {
    width: auto;
    max-width: none;
    zoom: 2;
  }
  &[data-zoom="400"] .stage__img {
    width: auto;
    max-width: none;
    zoom: 4;
  }
  /* Zoomed in, show real pixels instead of a smoothed blur. */
  &[data-zoom="200"] .stage__img,
  &[data-zoom="400"] .stage__img {
    image-rendering: pixelated;
  }
  /* Design variant: the render is scaled to the screenshot's width, as its note says. */
  &[data-variant="design"] .stage__img {
    width: 100%;
  }
  /* No baseline: one image, so one column. */
  &[data-single] .stage__grid {
    grid-template-columns: minmax(0, 1fr);
  }
  &:not([data-view="diff"]) .stage__pane[data-pane="diff"] {
    display: none;
  }
  &[data-view="diff"] .stage__grid,
  &[data-view="flip"] .stage__grid,
  &[data-view="swipe"] .stage__grid,
  &[data-view="onion"] .stage__grid {
    grid-template-columns: minmax(0, 1fr);
  }
  &[data-view="diff"] .stage__pane:not([data-pane="diff"]) {
    display: none;
  }
  &[data-view="flip"][data-flip="baseline"] .stage__pane:not([data-pane="baseline"]),
  &[data-view="flip"]:not([data-flip="baseline"]) .stage__pane:not([data-pane="current"]) {
    display: none;
  }
  &[data-view="swipe"] .stage__pane,
  &[data-view="onion"] .stage__pane,
  &[data-view="swipe"] .stage__divider {
    grid-area: 1 / 1;
  }
  &[data-view="swipe"] .stage__label,
  &[data-view="onion"] .stage__label {
    display: none;
  }
  &[data-view="swipe"] .stage__pane[data-pane="current"] {
    clip-path: inset(0 0 0 var(--swipe, 50%));
    background: transparent;
  }
  &[data-view="onion"] .stage__pane[data-pane="current"] {
    opacity: var(--onion, 0.5);
    background: transparent;
  }
  &[data-view="swipe"] .stage__divider {
    position: relative;
    display: block;
    z-index: 3;
    justify-self: start;
    width: 2px;
    height: 100%;
    margin-left: var(--swipe, 50%);
    background: var(--accent);
    pointer-events: none;
  }
  /* The only part of the divider that takes pointer input: drag it to wipe. */
  .stage__knob {
    position: absolute;
    top: 50%;
    left: 50%;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    transform: translate(-50%, -50%);
    background: var(--accent);
    color: var(--accent-contrast);
    border: 2px solid var(--surface-card);
    border-radius: var(--radius-pill);
    box-shadow: var(--shadow-2);
    font-size: var(--text-lg);
    line-height: 1;
    cursor: ew-resize;
    pointer-events: auto;
    touch-action: none;
    user-select: none;
  }
  &[data-view="flip"] .stage__grid {
    cursor: pointer;
  }
  &[data-view="swipe"] .stage__controls[data-for="swipe"],
  &[data-view="onion"] .stage__controls[data-for="onion"] {
    display: flex;
  }
`;

const DEFAULT_BASELINE_EMPTY = "New story — no baseline yet. Approve to set the baseline.";

const MODES = [
  { label: "Side by side", value: "split" },
  { label: "Swipe", value: "swipe" },
  { label: "Onion skin", value: "onion" },
  { label: "Diff", value: "diff" },
  { label: "Flip", value: "flip" },
];

const ZOOMS = [
  { label: "Fit", value: "fit" },
  { label: "100%", value: "100" },
  { label: "200%", value: "200" },
  { label: "400%", value: "400" },
];

/** Modes and zoom a design comparison offers: no pixel diff, and the render always fits the stage. */
const DESIGN_MODES = ["split", "swipe", "onion"];

function withActive(
  items: { label: string; value: string }[],
  active: string,
): { label: string; value: string; active: boolean }[] {
  return items.map((item) => ({ ...item, active: item.value === active }));
}

/** An image's natural size in pixels. */
export interface ImageSize {
  width: number;
  height: number;
}

/** "120×100", the way the stage and the review header print a size. */
export function formatSize(size: ImageSize): string {
  return `${size.width}×${size.height}`;
}

/** True when both sizes are known and differ: the images cannot be diffed pixel for pixel. */
export function sizesDiffer(
  baseline: ImageSize | null | undefined,
  current: ImageSize | null | undefined,
): boolean {
  return Boolean(
    baseline && current && (baseline.width !== current.width || baseline.height !== current.height),
  );
}

/**
 * The common width both images are drawn against: the wider natural width, or null when either size
 * is unknown (each image is then capped at its own natural width).
 */
function sharedWidth(
  baseline: ImageSize | null | undefined,
  current: ImageSize | null | undefined,
): number | null {
  return baseline && current ? Math.max(baseline.width, current.width) : null;
}

/**
 * An image drawn at the stage's one scale: an SVG `box` pixels wide (the wider image), holding the
 * image at its natural size. CSS caps the SVG at the pane width and never stretches it past `box`,
 * so every image on the stage shrinks by the same factor and none is upscaled. Sizes are attributes
 * computed on the server; no style value is.
 */
const ScaledImage: FC<{ src: string; alt: string; size: ImageSize; box: number }> = ({
  src,
  alt,
  size,
  box,
}) => (
  <svg
    class="stage__img"
    data-scaled=""
    viewBox={`0 0 ${box} ${size.height}`}
    width={box}
    height={size.height}
    preserveAspectRatio="xMinYMin meet"
    role="img"
    aria-label={alt}
  >
    <image href={src} width={size.width} height={size.height} />
    <rect class="stage__outline" width={size.width} height={size.height} />
  </svg>
);

interface PaneProps {
  kind: "baseline" | "current" | "diff";
  label: string;
  src: string | null;
  alt: string;
  empty: unknown;
  meta?: string;
  /** The image's natural size; with `box`, it is drawn at the stage's shared scale. */
  size?: ImageSize | null;
  box?: number | null;
}

/** The pane's image: at the shared scale when both sizes are known, else capped at its own width. */
const PaneImage: FC<{ src: string; alt: string; size?: ImageSize | null; box?: number | null }> = ({
  src,
  alt,
  size,
  box,
}) =>
  size && box ? (
    <ScaledImage src={src} alt={alt} size={size} box={box} />
  ) : (
    <img class="stage__img" src={src} alt={alt} loading="lazy" decoding="async" />
  );

/**
 * One image pane. It scrolls when the image is larger than the pane (zoomed in, or a tall screenshot),
 * so with an image it takes keyboard focus and a name, and the arrow keys pan it.
 */
const Pane: FC<PaneProps> = ({ kind, label, src, alt, empty, meta, size, box }) => {
  return (
    <div
      class="stage__pane"
      data-pane={kind}
      tabindex={src ? 0 : undefined}
      role={src ? "group" : undefined}
      aria-label={src ? `${label} screenshot` : undefined}
    >
      <div class="stage__label">
        <span>{label}</span>
        {meta ? <span>{meta}</span> : size ? <span>{formatSize(size)}</span> : null}
      </div>
      {src ? (
        <div class="stage__canvas">
          <PaneImage src={src} alt={alt} size={size} box={box} />
        </div>
      ) : (
        <div class="stage__empty">{empty}</div>
      )}
    </div>
  );
};

/** Swipe and onion-skin sliders; each is shown only in its own mode (CSS). */
const RangeControls: FC<{ baselineLabel: string }> = ({ baselineLabel }) => {
  return (
    <>
      <label class="stage__controls" data-for="swipe">
        <span>{baselineLabel}</span>
        <input type="range" min="0" max="100" value="50" data-compare-swipe aria-label="Swipe" />
        <span>Current</span>
      </label>
      <label class="stage__controls" data-for="onion">
        <span>{baselineLabel}</span>
        <input type="range" min="0" max="100" value="50" data-compare-onion aria-label="Opacity" />
        <span>Current</span>
      </label>
    </>
  );
};

/** Props for the screenshot comparison surface. */
export interface CompareStageProps {
  /** Baseline image URL, or null when the story has no baseline yet. */
  baselineSrc: string | null;
  currentSrc: string;
  /** Diff overlay URL, or null when none was produced. */
  diffSrc: string | null;
  /** Accessible description shared by the images, e.g. "Button / Primary". */
  subject: string;
  baselineEmpty?: unknown;
  diffEmpty?: unknown;
  diffMeta?: string;
  /**
   * `design` compares the screenshot with a design render instead of a baseline: side by side,
   * swipe and onion only (no diff, no flip), fit zoom only.
   */
  variant?: "baseline" | "design";
  /** Name of the left-hand image in labels and sliders (default "Baseline"). */
  baselineLabel?: string;
  /** A line under the controls, e.g. what the left-hand image is. */
  note?: string;
  /** Natural size of the baseline image (read from its header on the server), when known. */
  baselineSize?: ImageSize | null;
  /** Natural size of the current screenshot, when known. With both sizes, Fit uses one scale. */
  currentSize?: ImageSize | null;
}

/** Mode switch, plus the zoom switch (a design comparison always fits, so it has none). */
const StageBar: FC<{ design: boolean }> = ({ design }) => {
  const modes = design ? MODES.filter((mode) => DESIGN_MODES.includes(mode.value)) : MODES;
  return (
    <div class="stage__bar">
      <Segmented label="Comparison mode" data-compare-mode items={withActive(modes, "split")} />
      {design ? null : (
        <Segmented label="Zoom" data-compare-zoom items={withActive(ZOOMS, "fit")} />
      )}
    </div>
  );
};

/** The swipe divider and its draggable knob (shown in swipe mode only). */
const SwipeDivider: FC = () => (
  <span class="stage__divider" aria-hidden="true">
    <span class="stage__knob" data-compare-knob>
      ↔
    </span>
  </span>
);

/** The panes (baseline or design, current, diff) and the swipe divider. */
const StageGrid: FC<CompareStageProps & { design: boolean; baselineLabel: string }> = ({
  baselineSrc,
  currentSrc,
  diffSrc,
  subject,
  baselineEmpty = DEFAULT_BASELINE_EMPTY,
  diffEmpty = "No diff",
  diffMeta,
  design,
  baselineLabel,
  baselineSize,
  currentSize,
}) => {
  const box = design ? null : sharedWidth(baselineSize, currentSize);
  return (
    <div class="stage__grid">
      <Pane
        kind="baseline"
        label={baselineLabel}
        src={baselineSrc}
        alt={`${baselineLabel} for ${subject}`}
        empty={baselineEmpty}
        size={design ? null : baselineSize}
        box={box}
      />
      <Pane
        kind="current"
        label="Current"
        src={currentSrc}
        alt={`Current for ${subject}`}
        empty="No screenshot"
        size={design ? null : currentSize}
        box={box}
      />
      {design ? null : (
        <Pane
          kind="diff"
          label="Diff"
          src={diffSrc}
          alt={`Diff for ${subject}`}
          empty={diffEmpty}
          meta={diffMeta}
        />
      )}
      <SwipeDivider />
    </div>
  );
};

/**
 * A snapshot with no baseline: the current screenshot, the zoom switch and one line saying why there is
 * nothing to compare. No mode switch, diff pane, divider or range. `data-modes="split"` makes the review
 * script refuse the other mode keys, and the flip click and `t` key do nothing because the view never flips.
 */
const SingleStage: FC<{
  currentSrc: string;
  subject: string;
  emptyText: unknown;
  diffSrc: string | null;
  currentSize?: ImageSize | null;
}> = ({ currentSrc, subject, emptyText, diffSrc, currentSize }) => (
  <div
    class={stageRoot}
    data-compare
    data-single=""
    data-view="split"
    data-zoom="fit"
    data-flip="current"
    data-variant="baseline"
    data-modes="split"
  >
    <div class="stage__bar">
      <Segmented label="Zoom" data-compare-zoom items={withActive(ZOOMS, "fit")} />
    </div>
    <p class="stage__note">{emptyText}</p>
    {diffSrc ? (
      <p class="stage__note">
        <a href={diffSrc}>Open the saved diff</a>
      </p>
    ) : null}
    <div class="stage__grid">
      <Pane
        kind="current"
        label="Current"
        src={currentSrc}
        alt={`Current for ${subject}`}
        empty="No screenshot"
        size={currentSize}
      />
    </div>
  </div>
);

/** Baseline / current / diff comparison with swipe, onion-skin, flip, and zoom. */
export const CompareStage: FC<CompareStageProps> = ({
  variant = "baseline",
  baselineLabel = "Baseline",
  note,
  ...images
}) => {
  const design = variant === "design";
  if (!design && images.baselineSrc === null) {
    return (
      <SingleStage
        currentSrc={images.currentSrc}
        subject={images.subject}
        emptyText={images.baselineEmpty ?? DEFAULT_BASELINE_EMPTY}
        diffSrc={images.diffSrc}
        currentSize={images.currentSize}
      />
    );
  }
  return (
    <div
      class={stageRoot}
      data-compare
      data-view="split"
      data-zoom="fit"
      data-flip="current"
      data-variant={variant}
      data-modes={design ? DESIGN_MODES.join(",") : undefined}
      data-zooms={design ? "fit" : undefined}
    >
      <StageBar design={design} />
      {note ? <p class="stage__note">{note}</p> : null}
      <StageGrid {...images} design={design} baselineLabel={baselineLabel} />
      <RangeControls baselineLabel={baselineLabel} />
    </div>
  );
};
