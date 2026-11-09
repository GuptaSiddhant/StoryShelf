// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import { renderNotFoundPage } from "./not-found.tsx";

const meta: Meta = { title: "Pages/Account/Not found" };
export default meta;

export const SignedOut = pageStory(() =>
  renderNotFoundPage({
    message: "Project not found",
    signInHref: "/auth/login?return_to=%2Fprojects%2Facme%2Fstorybook",
  }),
);

export const SignedIn = pageStory(() => renderNotFoundPage({ message: "Project not found" }));

export const NoSuchPage = pageStory(() => renderNotFoundPage({ message: "Not found" }));
