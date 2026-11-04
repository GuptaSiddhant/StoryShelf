// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import {
  baselineShot,
  currentShot,
  designShot,
  diffShot,
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

export const NewStory = jsxStory(() => (
  <CompareStage
    baselineSrc={null}
    currentSrc={currentShot}
    diffSrc={null}
    subject="Kit / Button / Default"
    baselineEmpty="No baseline yet: this story is new."
    diffEmpty="Nothing to compare."
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
