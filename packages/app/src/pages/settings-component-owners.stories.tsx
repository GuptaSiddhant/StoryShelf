// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { project } from "../stories-fixtures/dataset.ts";
import { ComponentOwnersCard } from "./settings-component-owners.tsx";

const meta: Meta = { title: "Pages/Settings/Component owners" };
export default meta;

const RULES = [
  { pattern: "src/components/forms/**", owners: ["user_01HFORMS", "user_02JDESIGN"] },
  { pattern: "src/components/charts/**", owners: ["user_03KCHARTS"] },
];

export const AdminEmpty = jsxStory(() => (
  <ComponentOwnersCard project={project} rules={[]} isAdmin />
));

export const AdminSaved = jsxStory(() => (
  <ComponentOwnersCard project={project} rules={RULES} isAdmin />
));

export const AdminInvalid = jsxStory(() => (
  <ComponentOwnersCard
    project={project}
    rules={RULES}
    isAdmin
    formState={{
      ownerText:
        "src/components/forms/**  user_01HFORMS\nsrc/components/charts/**  user_9Z\nsrc/empty/**",
      ownerProblems: [
        { line: 2, message: "`user_9Z` is not a member of this project." },
        { line: 3, message: "no owners listed." },
      ],
    }}
  />
));

export const NonAdmin = jsxStory(() => (
  <ComponentOwnersCard project={project} rules={RULES} isAdmin={false} />
));

export const ReviewOff = jsxStory(() => (
  <ComponentOwnersCard project={{ ...project, reviewEnabled: false }} rules={RULES} isAdmin />
));
