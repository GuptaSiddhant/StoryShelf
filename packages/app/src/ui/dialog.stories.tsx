// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { Button, Dialog, DialogLink, Field, VStack } from "./components.tsx";

const meta: Meta = { title: "UI/Dialog" };
export default meta;

export const Opener = jsxStory(() => (
  <DialogLink dialogId="edit-git" href="/settings/git/edit">
    Edit connection
  </DialogLink>
));

export const OpenForm = jsxStory(() => (
  <VStack>
    <Dialog
      id="edit-git"
      title="Edit connection"
      footer={
        <>
          <Button variant="secondary" data-dialog-close>
            Cancel
          </Button>
          <Button type="submit" form="edit-git-form">
            Save
          </Button>
        </>
      }
    >
      <form id="edit-git-form" method="post">
        <Field label="Name" name="name" value="Acme" />
      </form>
    </Dialog>
  </VStack>
));
