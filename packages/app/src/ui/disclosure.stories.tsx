// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { DefinitionList, Disclosure } from "./components.tsx";

const meta: Meta = { title: "UI/Disclosure" };
export default meta;

const items = [
  { label: "Snapshots", value: 11 },
  { label: "Inherited", value: 4 },
  { label: "Changed / new", value: 3 },
];

export const Collapsed = jsxStory(() => (
  <Disclosure title="Details" hint="11 snapshots">
    <DefinitionList items={items} />
  </Disclosure>
));

export const Open = jsxStory(() => (
  <Disclosure title="Details" open>
    <DefinitionList items={items} />
  </Disclosure>
));
