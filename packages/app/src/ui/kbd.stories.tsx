// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { HStack, Kbd, VStack } from "./components.tsx";

const meta: Meta = { title: "UI/Kbd" };
export default meta;

export const Keys = jsxStory(() => (
  <VStack>
    <HStack>
      Approve: <Kbd keys="a" />
    </HStack>
    <HStack>
      Next snapshot: <Kbd keys={["Shift", "J"]} />
    </HStack>
  </VStack>
));
