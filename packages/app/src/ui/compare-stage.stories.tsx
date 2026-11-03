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
