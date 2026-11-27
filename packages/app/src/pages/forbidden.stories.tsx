// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import { renderForbiddenPage } from "./forbidden.tsx";

const meta: Meta = { title: "Pages/Account/Forbidden" };
export default meta;

/** A signed-in member opens an admin page: the bare refusal, with the default sentence. */
export const NotAnAdmin = pageStory(() => renderForbiddenPage(), {
  store: {
    authEnabled: true,
    user: { id: "ada", email: "ada@example.com", name: "Ada", role: "member" },
  },
});

/** A refusal that says why: the role the token has, in the words the route gave. */
export const WithReason = pageStory(
  () =>
    renderForbiddenPage({
      message: "This token has the viewer role on the project, but this action needs an admin.",
    }),
  {
    store: {
      authEnabled: true,
      user: { id: "ada", email: "ada@example.com", name: "Ada", role: "viewer" },
    },
  },
);
