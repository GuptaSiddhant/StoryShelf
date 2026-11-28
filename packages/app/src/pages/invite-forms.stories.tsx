// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { FormDialog } from "./dialog-form.tsx";
import { INVITE_DIALOG, InviteForm, InviteLink } from "./invite-forms.tsx";

const meta: Meta = { title: "Pages/System/Invite form" };
export default meta;

/** Invite a user: the email, an optional name and the site role. */
export const Invite = jsxStory(() => (
  <FormDialog id={INVITE_DIALOG} title="Invite a user" submitLabel="Create invite link" open>
    <InviteForm standalone={false} />
  </FormDialog>
));

/** From Add member, the address is carried over. */
export const InviteWithEmail = jsxStory(() => (
  <FormDialog id={INVITE_DIALOG} title="Invite a user" submitLabel="Create invite link" open>
    <InviteForm standalone={false} email="ana@example.com" />
  </FormDialog>
));

/** Refused: the address is not an email. */
export const InviteError = jsxStory(() => (
  <FormDialog id={INVITE_DIALOG} title="Invite a user" submitLabel="Create invite link" open>
    <InviteForm standalone={false} email="ana" error="Enter a valid email" />
  </FormDialog>
));

/** The one-time link with a confirmed origin: shown once, to copy. */
export const LinkShownOnce = jsxStory(() => (
  <FormDialog id={INVITE_DIALOG} title="Invite a user" submitLabel="Create invite link" open>
    <InviteLink
      link="https://shelf.example.com/auth/invites/01JEXAMPLE?token=inv_example"
      email="ana@example.com"
      expiresAt="2026-12-04T00:00:00.000Z"
      absolute
    />
  </FormDialog>
));

/** The link with no confirmed origin: a path to put the server address in front of. */
export const LinkWithoutOrigin = jsxStory(() => (
  <FormDialog id={INVITE_DIALOG} title="Invite a user" submitLabel="Create invite link" open>
    <InviteLink
      link="/auth/invites/01JEXAMPLE?token=inv_example"
      email="ana@example.com"
      expiresAt="2026-12-04T00:00:00.000Z"
      absolute={false}
    />
  </FormDialog>
));
