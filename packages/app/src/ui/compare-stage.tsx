import type { FC } from "hono/jsx";
import { css } from "./css.ts";
import { Segmented } from "./segmented.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/**
 * Screenshot comparison surface. All modes share one set of images; the
 * `data-view` / `data-zoom` / `data-flip` attributes on the root (driven by
 * the review script) decide what is shown. Without JS it stays side-by-side.
 */
const stageRoot = css`
  /* compare-stage */
  display: grid;
  gap: var(--space-3);
  .stage__bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
  }
  .stage__grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
    align-items: start;
  }
  .stage__pane {
    position: relative;
    min-width: 0;
    max-height: 78vh;
    overflow: auto;
    background: var(--surface-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .stage__pane:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
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
  .stage__img {
    display: block;
    width: 100%;
    height: auto;
    background: repeating-conic-gradient(var(--surface-muted) 0% 25%, var(--surface-subtle) 0% 50%)
      0 0 / 16px 16px;
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
  /* Design variant: screenshot against a render, two panes and no diff. */
  &[data-variant="design"][data-view="split"] .stage__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
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
  &[data-view="swipe"] .stage__pane[data-pane="diff"],
  &[data-view="onion"] .stage__pane[data-pane="diff"] {
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

interface PaneProps {
  kind: "baseline" | "current" | "diff";
  label: string;
  src: string | null;
  alt: string;
  empty: unknown;
  meta?: string;
}

/**
 * One image pane. It scrolls when the image is larger than the pane (zoomed in, or a tall screenshot),
 * so with an image it takes keyboard focus and a name, and the arrow keys pan it.
 */
const Pane: FC<PaneProps> = ({ kind, label, src, alt, empty, meta }) => {
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
        {meta ? <span>{meta}</span> : null}
      </div>
      {src ? (
        <img class="stage__img" src={src} alt={alt} loading="lazy" decoding="async" />
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

/** The panes (baseline or design, current, diff) and the swipe divider. */
const StageGrid: FC<CompareStageProps & { design: boolean; baselineLabel: string }> = ({
  baselineSrc,
  currentSrc,
  diffSrc,
  subject,
  baselineEmpty = "New story — no baseline yet. Approve to set the baseline.",
  diffEmpty = "No diff",
  diffMeta,
  design,
  baselineLabel,
}) => (
  <div class="stage__grid">
    <Pane
      kind="baseline"
      label={baselineLabel}
      src={baselineSrc}
      alt={`${baselineLabel} for ${subject}`}
      empty={baselineEmpty}
    />
    <Pane
      kind="current"
      label="Current"
      src={currentSrc}
      alt={`Current for ${subject}`}
      empty="No screenshot"
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
    <span class="stage__divider" aria-hidden="true">
      <span class="stage__knob" data-compare-knob>
        ↔
      </span>
    </span>
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
