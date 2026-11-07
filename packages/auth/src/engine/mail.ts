/** Auth mail: the sender address, reset and invite mail, and the invite lifecycle (best-effort delivery). */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { Auth } from "@storyshelf/core/auth";
import { acceptInvite, issueInvite, verifyInvite } from "../invites.ts";
import { ENGINE_PROVIDER_ID, type ShelfAuthOptions } from "./types.ts";

/** Default sender address derived from the public base URL host. */
function defaultFromEmail(baseURL: string): string {
  try {
    return `storyshelf@${new URL(baseURL).hostname}`;
  } catch {
    return "storyshelf@localhost";
  }
}

/** Send one auth mail; throws so callers decide best-effort policy. */
export async function sendAuthMail(
  options: Pick<ShelfAuthOptions, "emailSender" | "fromEmail" | "baseURL">,
  message: { to: string; subject: string; text: string },
): Promise<void> {
  await options.emailSender?.send({
    to: message.to,
    subject: message.subject,
    text: message.text,
    from: options.fromEmail ?? defaultFromEmail(options.baseURL),
  });
}

/** Send the invite link best-effort; the token is always still returned. */
async function sendInviteMail(
  options: ShelfAuthOptions,
  email: string,
  issued: { inviteId: string; token: string; expiresAt: string },
): Promise<void> {
  try {
    await options.onAuthSystemEvent?.("sys:invite-issued", {
      email,
      inviteId: issued.inviteId,
      expiresAt: issued.expiresAt,
    });
  } catch (error) {
    options.logger?.warn({ err: error, email }, "auth system hook failed");
  }
  if (!options.emailSender) {
    return;
  }
  const link = `${options.baseURL.replace(/\/+$/u, "")}/auth/invites/${issued.inviteId}?token=${issued.token}`;
  try {
    await sendAuthMail(options, {
      to: email,
      subject: "Your StoryShelf invite",
      text: `Accept your invite here (expires ${issued.expiresAt}): ${link}`,
    });
  } catch (error) {
    // Fictional/internal addresses never deliver: log and keep the token
    // usable out-of-band.
    options.logger?.warn({ err: error, email }, "invite email failed");
  }
}

/** Invite lifecycle methods for the Auth singleton (best-effort mail). */
export function buildInviteMethods(
  db: DatabaseAdapter,
  options: ShelfAuthOptions,
): Pick<Auth, "issueInvite" | "verifyInvite" | "acceptInvite"> {
  return {
    issueInvite: async (input) => {
      const issued = await issueInvite(db, input);
      await sendInviteMail(options, input.email, issued);
      return issued;
    },
    verifyInvite: async (input) => await verifyInvite(db, input),
    acceptInvite: async (input) => {
      // Direct credential writes bypass Better Auth's databaseHooks, so the
      // mirror hook never sees invite accepts: emit the creation here.
      const user = await acceptInvite(db, input);
      try {
        await options.onAuthSystemEvent?.("sys:user-created", {
          userId: user.id,
          email: user.email,
          name: user.name,
        });
      } catch (error) {
        options.logger?.warn({ err: error, userId: user.id }, "auth system hook failed");
      }
      return { ...user, providerId: ENGINE_PROVIDER_ID };
    },
  };
}
