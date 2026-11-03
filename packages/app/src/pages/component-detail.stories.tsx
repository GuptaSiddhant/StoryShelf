// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { storyContext } from "../../.storybook/context.ts";
import { pageStory } from "../../.storybook/page.tsx";
import { loadComponentPage } from "../routers/component.handlers.ts";
import { renderComponentPage } from "./component-detail.tsx";

const meta: Meta = { title: "Pages/Library/Component" };
export default meta;

const page = async (tab: string, path = "./src/Button.stories.tsx"): Promise<unknown> => {
  const data = await loadComponentPage(storyContext, "design-system", path, tab);
  if (!data) throw new Error("the story's component page did not load");
  return renderComponentPage(data);
};

export const States = pageStory(() => page("states"));

export const Stories = pageStory(() => page("stories"));

export const History = pageStory(() => page("history"));

export const TestingOff = pageStory(() => page("stories"), { store: { testing: false } });
