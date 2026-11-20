// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { Field, OptionFields } from "./components.tsx";

const meta: Meta = { title: "UI/OptionFields" };
export default meta;

const options = [
  {
    value: "github",
    label: "GitHub",
    children: <Field label="Repository" name="repo" value="acme/app" />,
  },
  {
    value: "gitlab",
    label: "GitLab",
    children: <Field label="Project path" name="path" value="" />,
  },
];

export const Segmented = jsxStory(() => (
  <OptionFields name="provider" label="Git host" options={options} selected="github" />
));

export const SecondSelected = jsxStory(() => (
  <OptionFields name="provider" label="Git host" options={options} selected="gitlab" />
));

export const Cards = jsxStory(() => (
  <OptionFields name="provider" label="Git host" variant="cards" options={options} />
));
