// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta, StoryObj } from "@storybook/html-vite";
import { expect } from "storybook/test";
import {
  baselineShot,
  currentShot,
  designShot,
  diffShot,
  sizedShot,
  squareShot,
  wideShot,
} from "../../.storybook/assets/screens.ts";
import { jsxStory } from "../../.storybook/render.tsx";
import { CompareStage } from "./components.tsx";

const meta: Meta = { title: "UI/CompareStage", parameters: { layout: "padded" } };
export default meta;

export const AgainstBaseline = jsxStory(() => (
  <CompareStage
    baselineSrc={baselineShot}
    currentSrc={currentShot}
    diffSrc={diffShot}
    subject="Kit / Button / Default"
    diffMeta="2.4% of pixels differ"
  />
));

/** Both natural sizes known (640×400): one scale for both panes, sizes in the pane labels. */
export const Changed = jsxStory(() => (
  <CompareStage
    baselineSrc={baselineShot}
    currentSrc={currentShot}
    diffSrc={diffShot}
    subject="Kit / Button / Default"
    diffMeta="2.4% of pixels differ"
    baselineSize={{ width: 640, height: 400 }}
    currentSize={{ width: 640, height: 400 }}
  />
));

/** Unchanged: the same image on both sides, and the diff mode says why it is empty. */
export const Unchanged = jsxStory(() => (
  <CompareStage
    baselineSrc={baselineShot}
    currentSrc={baselineShot}
    diffSrc={null}
    subject="Kit / Button / Default"
    diffEmpty="No diff — within threshold"
    baselineSize={{ width: 640, height: 400 }}
    currentSize={{ width: 640, height: 400 }}
  />
));

/** The drawn width of a pane's image (the `<image>` inside the scaled SVG). */
function drawnWidth(canvas: HTMLElement, pane: "baseline" | "current"): number {
  const image = canvas.querySelector(`[data-pane="${pane}"] .stage__img image`);
  if (!image) throw new Error(`no scaled ${pane} image`);
  return image.getBoundingClientRect().width;
}

/**
 * Proof of one honest scale: the drawn widths keep the natural ratio, and neither image is drawn
 * wider than it really is. Runs in the browser on every Storybook check, so a regression fails it.
 */
async function assertOneScale(
  canvas: HTMLElement,
  natural: { baseline: number; current: number },
): Promise<void> {
  const baseline = drawnWidth(canvas, "baseline");
  const current = drawnWidth(canvas, "current");
  await expect(baseline / current).toBeCloseTo(natural.baseline / natural.current, 2);
  await expect(baseline).toBeLessThanOrEqual(natural.baseline + 0.5);
  await expect(current).toBeLessThanOrEqual(natural.current + 0.5);
}

const sizeChanged = (): unknown => (
  <CompareStage
    baselineSrc={squareShot}
    currentSrc={wideShot}
    diffSrc={null}
    subject="Components / Card"
    diffEmpty="No pixel diff: the images are different sizes (100×100 → 120×100), so they cannot be compared pixel for pixel."
    baselineSize={{ width: 100, height: 100 }}
    currentSize={{ width: 120, height: 100 }}
  />
);

/**
 * A size-only change, 100×100 → 120×100, in Fit: the baseline is drawn 100 px and the current
 * 120 px wide (never stretched to the pane), so the wider card looks wider.
 */
export const SizeChanged: StoryObj = {
  ...jsxStory(sizeChanged),
  play: async ({ canvasElement }) => {
    await assertOneScale(canvasElement, { baseline: 100, current: 120 });
  },
};

/** The same size change in the diff mode: no diff image, and the reason why. */
export const SizeChangedDiffMode = jsxStory(sizeChanged, { stage: { view: "diff" } });

/**
 * Images wider than the pane (2000×600 → 2400×600): both shrink by the same factor, so the ratio
 * holds while each is drawn smaller than its natural width.
 */
export const SizeChangedScaledDown: StoryObj = {
  ...jsxStory(() => (
    <CompareStage
      baselineSrc={sizedShot(2000, 600, "#1d5fcf")}
      currentSrc={sizedShot(2400, 600, "#1d5fcf")}
      diffSrc={null}
      subject="Components / Banner"
      baselineSize={{ width: 2000, height: 600 }}
      currentSize={{ width: 2400, height: 600 }}
    />
  )),
  play: async ({ canvasElement }) => {
    await assertOneScale(canvasElement, { baseline: 2000, current: 2400 });
  },
};

/** A new story: only the screenshot, the zoom switch and the reason there is nothing to compare. */
export const NewStory = jsxStory(() => (
  <CompareStage
    baselineSrc={null}
    currentSrc={currentShot}
    diffSrc={null}
    subject="Kit / Button / Default"
    baselineEmpty="No baseline yet: this story is new."
  />
));

/** A snapshot whose baseline image is missing: the same single view, with the unavailable line. */
export const BaselineUnavailable = jsxStory(() => (
  <CompareStage
    baselineSrc={null}
    currentSrc={currentShot}
    diffSrc={null}
    subject="Kit / Button / Default"
    baselineEmpty="The original baseline image is unavailable."
  />
));

export const AgainstDesign = jsxStory(() => (
  <CompareStage
    variant="design"
    baselineLabel="Figma"
    baselineSrc={designShot}
    currentSrc={currentShot}
    diffSrc={null}
    subject="Kit / Button / Default"
    note="Compared with the linked Figma frame, not a baseline."
  />
));

/* One story per comparison mode and zoom, so each view is a fixed state that can be captured. */

/** A changed snapshot: baseline, current and diff, with the diff summary. */
const againstBaseline = (): unknown => (
  <CompareStage
    baselineSrc={baselineShot}
    currentSrc={currentShot}
    diffSrc={diffShot}
    subject="Kit / Button / Default"
    diffMeta="2.4% of pixels differ"
  />
);

/** The linked Figma frame beside the screenshot: side by side, swipe and onion, fit zoom only. */
const againstDesignFrame = (): unknown => (
  <CompareStage
    variant="design"
    baselineLabel="Figma"
    baselineSrc={designShot}
    currentSrc={currentShot}
    diffSrc={null}
    subject="Kit / Button / Default"
    note="Compared with the linked Figma frame, not a baseline."
  />
);

/** Swipe: drag the divider to wipe between the baseline and the current screenshot. */
export const Swipe = jsxStory(againstBaseline, { stage: { view: "swipe" } });

/** Onion skin: the current screenshot over the baseline at half opacity. */
export const OnionSkin = jsxStory(againstBaseline, { stage: { view: "onion" } });

/** Diff only: the changed pixels, nothing else. */
export const DiffOnly = jsxStory(againstBaseline, { stage: { view: "diff" } });

/** Flip, showing the current screenshot (click the image to flip to the baseline). */
export const Flip = jsxStory(againstBaseline, { stage: { view: "flip" } });

/** Flip, showing the baseline side. */
export const FlipShowingBaseline = jsxStory(againstBaseline, {
  stage: { view: "flip", flip: "baseline" },
});

export const Zoom100 = jsxStory(againstBaseline, { stage: { zoom: "100" } });
export const Zoom200 = jsxStory(againstBaseline, { stage: { zoom: "200" } });
export const Zoom400 = jsxStory(againstBaseline, { stage: { zoom: "400" } });

/** Against a design: swipe (a design comparison has no diff or flip, and always fits). */
export const DesignSwipe = jsxStory(againstDesignFrame, { stage: { view: "swipe" } });

/** Against a design: onion skin. */
export const DesignOnionSkin = jsxStory(againstDesignFrame, { stage: { view: "onion" } });

/**
 * The controls work here: the shell's own client script is loaded for this story only (every
 * other story is a fixed state). Try the modes, the zoom levels, the sliders and the flip.
 */
export const Interactive = jsxStory(againstBaseline, { interactive: true });
