// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import { project } from "../stories-fixtures/dataset.ts";
import { Field } from "../ui/components.tsx";
import { DialogForm, renderFormPage } from "./dialog-form.tsx";

const meta: Meta = { title: "Pages/Forms/Standalone form page" };
export default meta;

/** The page a dialog form falls back to: the shared 640 px column in a card, submit then Cancel. */
export const NewToken = pageStory(() =>
  renderFormPage(
    project,
    "access",
    "New token",
    <DialogForm
      dialog="new-token"
      action={`/projects/${project.slug}/settings/tokens`}
      submitLabel="Create token"
      standalone
      backHref={`/projects/${project.slug}/settings/access`}
    >
      <Field label="Name" name="name" required placeholder="CI upload" />
      <Field label="Expires in (days)" name="days" type="number" value="90" />
    </DialogForm>,
  ),
);
