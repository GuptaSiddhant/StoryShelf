// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { FormDialog } from "./dialog-form.tsx";
import { EDIT_ORIGIN_DIALOG, OriginForm } from "./public-origin-forms.tsx";

const meta: Meta = { title: "Pages/System/Public origin form" };
export default meta;

/** Nothing was reported: enter the address by hand. */
export const Enter = jsxStory(() => (
  <FormDialog id={EDIT_ORIGIN_DIALOG} title="Public origin" submitLabel="Save" open>
    <OriginForm stored={null} standalone={false} />
  </FormDialog>
));

/** An address was detected from the admin's browser: confirm it or change it. */
export const ConfirmDetected = jsxStory(() => (
  <FormDialog id={EDIT_ORIGIN_DIALOG} title="Public origin" submitLabel="Confirm" open>
    <OriginForm
      stored={{ origin: "https://shelf.example.com", confirmed: false }}
      standalone={false}
    />
  </FormDialog>
));

/** A confirmed address: change it if it is not the one people use. */
export const EditConfirmed = jsxStory(() => (
  <FormDialog id={EDIT_ORIGIN_DIALOG} title="Public origin" submitLabel="Save" open>
    <OriginForm
      stored={{ origin: "https://shelf.example.com", confirmed: true }}
      standalone={false}
    />
  </FormDialog>
));
