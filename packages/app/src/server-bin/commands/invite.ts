import { adminCall, adminTokenOf } from "../admin-call.ts";
import { withInstance, type CommandContext } from "./context.ts";

interface InviteResult {
  link: string;
  absolute: boolean;
  expiresAt: string;
}

/**
 * `invite <email>`: issue a one-time invite through the instance's own admin route and print the link
 * once, on stdout. Nothing else keeps it: it is never logged and the command stores no copy. Runs as
 * a `tool` with the admin token, so only an operator can invite.
 */
export async function invite(ctx: CommandContext): Promise<number> {
  const { email, name, role } = ctx.flags;
  return await withInstance(ctx, "tool", async ({ app, options }) => {
    const result = await adminCall<InviteResult>(
      app,
      adminTokenOf(options, ctx.env),
      "/api/v1/admin/invites",
      { email, ...(name === undefined ? {} : { name }), ...(role === undefined ? {} : { role }) },
    );
    ctx.io.out(result.link);
    ctx.io.err(
      `Invite for ${email} (expires ${result.expiresAt}). Shown once; run invite again to replace it.${
        result.absolute
          ? ""
          : " No public origin is configured: put your server's address in front of the link."
      }`,
    );
    return 0;
  });
}
