/**
 * Site admins invite a person (#1455): the one way to add a second user on a local-accounts
 * install. The admin form and the JSON route both call `issueInvite`; the link comes back once, in
 * the response, and is never logged or stored beyond the invite record. Site admin only: a caller
 * who is not one gets the same 403 whatever the email, before anything is looked up.
 */
import { createRoute, z } from "@hono/zod-openapi";
import type { Auth } from "@storyshelf/core/auth";
import { SITE_ROLES, type SiteRole } from "@storyshelf/core/types";
import { UserFacingError } from "@storyshelf/core/utils";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { errorBody } from "../middleware/api-errors.ts";
import { InviteForm, InviteLink } from "../pages/invite-forms.tsx";
import { getStore } from "../store.ts";
import { respondWithAdminForm } from "./form-response.tsx";
import { notFound, publicMessage, requireSiteAdmin } from "./helpers.ts";
import { errorSchema, forbidden as forbiddenResponse } from "./schemas.ts";

interface IssuedInvite {
  /** The invite path, `/auth/invites/<id>?token=<token>`; with `origin` it is made absolute. */
  link: string;
  absolute: boolean;
  email: string;
  expiresAt: string;
}

const inviteInput = z.object({
  email: z.string().min(3),
  name: z.string().optional(),
  role: z.enum(SITE_ROLES).optional(),
});

const inviteRoute = createRoute({
  method: "post",
  tags: ["Admin"],
  summary: "Invite a user (returns the one-time link once)",
  path: "/api/v1/admin/invites",
  request: { body: { content: { "application/json": { schema: inviteInput } } } },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: z.object({
            inviteId: z.string(),
            link: z.string(),
            absolute: z.boolean(),
            expiresAt: z.string(),
          }),
        },
      },
      description: "Invite issued; the link is not shown again",
    },
    400: { content: { "application/json": { schema: errorSchema } }, description: "Invalid input" },
    ...forbiddenResponse,
  },
});

/** The name an invite carries when none is given: the part of the email before the `@`. */
function defaultName(email: string): string {
  return email.split("@")[0]?.trim() || email;
}

/** Issue the invite and build its link: absolute only from a confirmed public origin. */
async function issue(
  auth: Auth,
  input: { email: string; name?: string | undefined; role?: SiteRole | undefined },
): Promise<IssuedInvite & { inviteId: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new UserFacingError("Enter a valid email");
  const { inviteId, token, expiresAt } = await auth.issueInvite({
    email,
    name: input.name?.trim() || defaultName(email),
    role: input.role ?? "member",
  });
  const path = `/auth/invites/${inviteId}?token=${encodeURIComponent(token)}`;
  // Never the request's Host: only an origin that is configured or confirmed (ADR 0007).
  const origin = await getStore().publicOrigin?.url();
  return {
    inviteId,
    email,
    expiresAt,
    absolute: origin !== undefined,
    link: origin === undefined ? path : `${origin}${path}`,
  };
}

function noStore(c: Context): void {
  c.header("Cache-Control", "no-store");
}

/** Register the invite form, its POST and the JSON route the CLI uses. */
export function registerAdminInvites(app: ShelfRouter, auth: Auth | undefined): void {
  app.get("/admin/invites/new", (c) => {
    requireSiteAdmin(c);
    if (!auth) return notFound();
    noStore(c);
    const email = c.req.query("email");
    return respondWithAdminForm(c, "Invite a user", (standalone) => (
      <InviteForm standalone={standalone} email={email} />
    ));
  });

  app.post("/admin/invites", async (c) => {
    requireSiteAdmin(c);
    if (!auth) return notFound();
    noStore(c);
    const form = await c.req.formData();
    const email = String(form.get("email") ?? "");
    const role = String(form.get("role") ?? "member");
    try {
      if (!(SITE_ROLES as readonly string[]).includes(role)) throw new Error("Invalid role");
      const issued = await issue(auth, {
        email,
        name: String(form.get("name") ?? ""),
        role: role as SiteRole,
      });
      return respondWithAdminForm(c, "Invite a user", () => (
        <InviteLink
          link={issued.link}
          email={issued.email}
          expiresAt={issued.expiresAt}
          absolute={issued.absolute}
        />
      ));
    } catch (error) {
      const message = publicMessage(error, "Could not create the invite");
      return respondWithAdminForm(
        c,
        "Invite a user",
        (standalone) => <InviteForm standalone={standalone} email={email} error={message} />,
        400,
      );
    }
  });

  app.openapi(inviteRoute, async (c) => {
    requireSiteAdmin(c);
    if (!auth) return notFound();
    noStore(c);
    try {
      const issued = await issue(auth, c.req.valid("json"));
      const { inviteId, link, absolute, expiresAt } = issued;
      return c.json({ inviteId, link, absolute, expiresAt }, 201);
    } catch (error) {
      return c.json(errorBody(publicMessage(error, "Could not create the invite")), 400);
    }
  });
}
