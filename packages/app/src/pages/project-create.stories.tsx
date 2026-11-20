// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone, pageStory } from "../../.storybook/page.tsx";
import { renderProjectCreatePage } from "./project-create.tsx";

const meta: Meta = { title: "Pages/Projects/Create" };
export default meta;

/** The empty form: name, git repository and default branch. */
export const Empty = pageStory(() => renderProjectCreatePage());

/** Values kept after a field was refused: each error sits on its own field. */
export const FieldErrors = pageStory(() =>
  renderProjectCreatePage({
    values: { name: "", gitRepository: "not a repository", gitDefaultBranch: "main" },
    errors: {
      name: "Enter a name for the project.",
      gitRepository: "Use the form owner/name.",
    },
  }),
);

/** The server refused the whole request (a slug already taken): the alert is above the form. */
export const CreateRefused = pageStory(() =>
  renderProjectCreatePage({
    values: { name: "Design system", gitRepository: "acme/design-system" },
    globalError: "A project named Design system already exists.",
  }),
);

/** The form on a 375px phone. */
export const OnAPhone = onAPhone(pageStory(() => renderProjectCreatePage()));
