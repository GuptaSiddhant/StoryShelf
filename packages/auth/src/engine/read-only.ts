/**
 * The engine half of read-only shared accounts (#1274): a Better Auth `before` hook that refuses
 * every engine endpoint a read-only account reaches, except signing in, signing out and reading its
 * own session. The app refuses its own routes in `readOnlyWrites`; this hook covers the engine's,
 * which the app mounts whole at `/api/auth/*` and which read the session cookie even when the request
 * also carries an `Authorization` header.
 */
import { READ_ONLY_ACCOUNT_MESSAGE } from "@storyshelf/core/auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";

/**
 * Engine endpoints a read-only account may reach, as Better Auth endpoint patterns: the sign-in
 * methods and their callbacks, sign-out and the session read. Every other endpoint is refused,
 * whatever its method, because some engine `GET`s write (email verification, account deletion).
 */
export const READ_ONLY_ENGINE_PATHS: ReadonlySet<string> = new Set([
  "/sign-in/email",
  "/sign-in/social",
  "/sign-in/sso",
  "/callback/:id",
  "/sso/callback",
  "/sso/callback/:providerId",
  "/sso/saml2/sp/acs/:providerId",
  "/sso/saml2/sp/metadata",
  "/passkey/generate-authenticate-options",
  "/passkey/verify-authentication",
  "/sign-out",
  "/get-session",
  "/ok",
  "/error",
]);

/** Endpoints a signed-out caller reaches by naming the account in the body (`email`). */
const NAMED_BY_EMAIL: ReadonlySet<string> = new Set([
  "/request-password-reset",
  "/send-verification-email",
]);

/** Endpoints that act on the user a password-reset token was minted for. */
const NAMED_BY_RESET_TOKEN: ReadonlySet<string> = new Set([
  "/reset-password",
  "/reset-password/:token",
]);

/** The slice of the hook context the guard reads (Better Auth's endpoint context). */
type GuardContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

function stringField(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) {
    return undefined;
  }
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The email of the user a password-reset token belongs to (undefined when the token is unknown). */
async function resetTokenEmail(ctx: GuardContext): Promise<string | undefined> {
  const token =
    stringField(ctx.body, "token") ?? stringField(ctx.query, "token") ?? ctx.params?.["token"];
  if (token === undefined || token === "") {
    return undefined;
  }
  const verification = await ctx.context.internalAdapter.findVerificationValue(
    `reset-password:${token}`,
  );
  if (!verification) {
    return undefined;
  }
  const user = await ctx.context.internalAdapter.findUserById(verification.value);
  return user?.email;
}

/** The account a signed-out request names, for the endpoints that take one. */
async function namedEmail(ctx: GuardContext): Promise<string | undefined> {
  if (NAMED_BY_EMAIL.has(ctx.path)) {
    return stringField(ctx.body, "email");
  }
  if (NAMED_BY_RESET_TOKEN.has(ctx.path)) {
    return await resetTokenEmail(ctx);
  }
  return undefined;
}

function refuse(): never {
  throw new APIError("FORBIDDEN", { message: READ_ONLY_ACCOUNT_MESSAGE });
}

/**
 * The `before` hook refusing a read-only account on every endpoint outside
 * {@link READ_ONLY_ENGINE_PATHS}: when the request names the account (a reset or verification mail,
 * a reset token), or when its session belongs to it. The refusal is a 403 with the one fixed
 * message, and nothing about the account is logged.
 */
export function readOnlyEngineGuard(
  isReadOnly: (email: string | null | undefined) => boolean,
): ReturnType<typeof createAuthMiddleware> {
  return createAuthMiddleware(async (ctx) => {
    if (READ_ONLY_ENGINE_PATHS.has(ctx.path)) {
      return;
    }
    if (isReadOnly(await namedEmail(ctx))) {
      refuse();
    }
    const session = await getSessionFromCtx(ctx);
    if (isReadOnly(session?.user.email)) {
      refuse();
    }
  });
}
