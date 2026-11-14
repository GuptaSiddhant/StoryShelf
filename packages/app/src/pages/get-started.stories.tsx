// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { project } from "../stories-fixtures/dataset.ts";
import { GetStarted } from "./get-started.tsx";

const meta: Meta = { title: "Pages/Get started/Card" };
export default meta;

const origin = "https://shelf.example.com";

export const Step1Token = jsxStory(() => <GetStarted project={project} origin={origin} />);

export const Step2Upload = jsxStory(() => (
  <GetStarted
    project={project}
    origin={origin}
    created={{ name: "CI", value: "shelf_5VYq3n0dHk8oXw2LrT9b" }}
  />
));

export const NoConfirmedOrigin = jsxStory(() => (
  <GetStarted
    project={project}
    origin={undefined}
    created={{ name: "CI", value: "shelf_5VYq3n0dHk8oXw2LrT9b" }}
  />
));
