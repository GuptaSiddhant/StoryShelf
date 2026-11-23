// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone, pageStory } from "../../.storybook/page.tsx";
import { renderInviteInvalidPage, renderInvitePage } from "./invite.tsx";

const meta: Meta = { title: "Pages/Account/Invite" };
export default meta;

const invite = { inviteId: "01JD000000000000000000INV001", token: "story-token" };

/** A valid invite: the invited address and the two password fields. */
export const SetPassword = pageStory(() =>
  renderInvitePage({ ...invite, email: "grace@example.com" }),
);

/** The password was refused (too short, or the two did not match): the error sits above the form. */
export const PasswordRefused = pageStory(() =>
  renderInvitePage({
    ...invite,
    email: "grace@example.com",
    error: "Passwords do not match.",
  }),
);

/** An invite that is expired, used or unknown: one message and a way back to sign in. */
export const InvalidInvite = pageStory(() =>
  renderInviteInvalidPage("This invite has expired or was already used."),
);

/** The form on a 375px phone. */
export const OnAPhone = onAPhone(
  pageStory(() => renderInvitePage({ ...invite, email: "grace@example.com" })),
);
