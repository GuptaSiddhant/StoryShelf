// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { BUILD_MAIN, project } from "../stories-fixtures/dataset.ts";
import { DefaultBranchNotice } from "./build-branch-notice.tsx";

const meta: Meta = { title: "Pages/Builds/Default branch notice" };
export default meta;

const build = { id: BUILD_MAIN, isDefault: false };

export const Refused = jsxStory(() =>
  DefaultBranchNotice({ project, build: { ...build, branchVerified: "refused" }, canReview: true }),
);

export const Unreachable = jsxStory(() =>
  DefaultBranchNotice({
    project,
    build: { ...build, branchVerified: "unreachable" },
    canReview: true,
  }),
);

export const Unverified = jsxStory(() =>
  DefaultBranchNotice({
    project,
    build: { ...build, branchVerified: "unverified" },
    canReview: false,
  }),
);

export const UnverifiedAccepted = jsxStory(() =>
  DefaultBranchNotice({
    project,
    build: { ...build, isDefault: true, branchVerified: "unverified" },
    canReview: true,
  }),
);
