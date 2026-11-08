// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta, StoryObj } from "@storybook/html-vite";
import { userEvent } from "storybook/test";
import { forcePseudoState } from "../../.storybook/pseudo-state.ts";
import { jsxStory } from "../../.storybook/render.tsx";
import { Option, OptionList } from "./components.tsx";

const meta: Meta = { title: "UI/OptionList" };
export default meta;

const choices = (selected?: string): ReturnType<typeof OptionList> => (
  <OptionList label="Mention a member">
    <Option selected={selected === "ana"}>
      @ana <span class="muted">Ana Ruiz</span>
    </Option>
    <Option selected={selected === "bo"}>
      @bo <span class="muted">Bo Chen</span>
    </Option>
    <Option selected={selected === "cy"} disabled>
      @cy <span class="muted">Cy Okafor</span>
    </Option>
  </OptionList>
);

/** The first option of a story: where hover, press and keyboard focus are forced. */
function firstOption(canvas: HTMLElement): HTMLElement {
  const first = canvas.querySelector<HTMLElement>("button");
  if (first === null) {
    throw new Error("the story has no option");
  }
  return first;
}

/** At rest: each option has a border, so the group reads as choices and not as plain text. */
export const Default = jsxStory(() => choices());

/** The selected option (`aria-current`): the same highlight a keyboard focus shows. */
export const Selected = jsxStory(() => choices("bo"));

/** The pointer over the first option (forced by `forcePseudoState`: a play function cannot make `:hover` real). */
export const Hover: StoryObj = {
  ...jsxStory(() => choices()),
  play: ({ canvasElement }) => {
    forcePseudoState(firstOption(canvasElement), "hover");
  },
};

/** The first option pressed (`:active`, forced the same way). */
export const Pressed: StoryObj = {
  ...jsxStory(() => choices()),
  play: ({ canvasElement }) => {
    forcePseudoState(firstOption(canvasElement), "active");
  },
};

/** Keyboard focus on the first option: the highlight matches the selected state, with the focus ring. */
export const KeyboardFocused: StoryObj = {
  ...jsxStory(() => choices()),
  play: async () => {
    await userEvent.tab();
  },
};
