// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { designShot } from "../../.storybook/assets/screens.ts";
import { jsxStory } from "../../.storybook/render.tsx";
import { DesignPreview, DesignReference, VStack } from "./components.tsx";

const meta: Meta = { title: "UI/DesignReference" };
export default meta;

export const Reference = jsxStory(() => (
  <DesignReference
    src={designShot}
    name="Button / Primary"
    href="https://www.figma.com/design/KEY/Kit?node-id=1-2"
    providerName="Figma"
  />
));

export const Preview = jsxStory(() => (
  <VStack>
    <DesignPreview src={designShot} name="Button / Primary" providerName="Figma" />
    <DesignPreview src={designShot} providerName="Figma" />
  </VStack>
));
