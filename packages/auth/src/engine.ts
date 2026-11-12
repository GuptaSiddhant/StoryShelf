import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
/**
 * Shelf auth engine: Better Auth protocol plumbing behind the Auth singleton.
 *
 * Sessions are wholesale Better Auth DB rows under our cookie name;
 * identities mirror into our `users` table (source of truth for roles,
 * memberships, and profile). All logins flow through engine endpoints
 * (mounted at `/api/auth/*`) — never through `createSession`, which exists
 * only for interface conformance and fails loudly.
 */
import { HOST_SESSION_COOKIE, SESSION_COOKIE } from "@storyshelf/core/types";
import { ulid } from "@storyshelf/core/utils";
import { betterAuth } from "better-auth";
import { baseAuthDateFields, baseAuthTables } from "./auth-tables.ts";
import { createShelfDbBridge } from "./db-bridge.ts";
import { buildAdapter, mirrorUser } from "./engine/adapter-bridge.ts";
import {
  assertNoReservedEndpointCollision,
  buildPlugins,
  buildSocialProviders,
  describeLoginMethods,
} from "./engine/login-methods.ts";
import { sendAuthMail } from "./engine/mail.ts";
import { SSO_MANAGEMENT_PATHS } from "./engine/sso.ts";
import type { ShelfAuth, ShelfAuthInstance, ShelfAuthOptions } from "./engine/types.ts";

// The public surface stays here: option types and the provider id live in engine/types.ts.
export { ENGINE_PROVIDER_ID } from "./engine/types.ts";
export type {
  EngineSessionUser,
  ShelfAuth,
  ShelfAuthInstance,
  ShelfAuthOptions,
  ShelfOAuthProvider,
  ShelfPasskeyOptions,
  ShelfSocialProvider,
  ShelfSSOGroupSync,
  ShelfSSOOidc,
  ShelfSSOOptions,
  ShelfSSOProvider,
  ShelfSSOSaml,
} from "./engine/types.ts";

/**
 * Create the shelf auth engine over any DatabaseAdapter.
 *
 * Returns the raw instance (mount `auth.handler`, call `auth.api.*`) plus
 * the Auth singleton (check/destroySession, invites, descriptors).
 */
export function createShelfAuth(options: ShelfAuthOptions): ShelfAuth {
  const { db } = options;
  // Fail fast at boot (login descriptors and plugin paths are fixed at creation).
  describeLoginMethods(options);
  assertNoReservedEndpointCollision(options.plugins);
  const shelf = buildAuthInstance(options, db);
  return { auth: shelf, adapter: buildAdapter(shelf, db, options) };
}

/**
 * Build the Better Auth instance with shelf-curated defaults: email/password,
 * DB sessions under our cookie name, no cookie cache (revocation and
 * disabled-users bite immediately), ULID ids shared with our `users` table,
 * mirror hook on user creation.
 */
function buildAuthInstance(options: ShelfAuthOptions, db: DatabaseAdapter): ShelfAuthInstance {
  const expiresIn = 60 * 60 * 24 * (options.sessionExpiresInDays ?? 7);
  const socialProviders = buildSocialProviders(options);
  const auth = betterAuth({
    baseURL: options.baseURL,
    secret: options.secret,
    database: createShelfDbBridge(db, {
      tables: baseAuthTables,
      dateFields: baseAuthDateFields,
    }),
    emailAndPassword: {
      enabled: options.emailPassword ?? true,
      requireEmailVerification: false,
      // Invite-only local accounts: public email signup stays off so the
      // only credential origins are invite accept, env bootstrap, and SSO
      // provisioning (all write identities directly, never via sign-up).
      disableSignUp: true,
      // User-requested resets work only when a sender is configured;
      // admins can always re-invite regardless.
      ...(options.emailSender
        ? {
            sendResetPassword: async (input: {
              user: { email: string };
              url: string;
            }): Promise<void> => {
              await sendAuthMail(options, {
                to: input.user.email,
                subject: "Reset your StoryShelf password",
                text: `Reset your password here (single use): ${input.url}`,
              });
            },
          }
        : {}),
    },
    // Native socials are option bags per provider key; our preset-built
    // records match those shapes, so narrow past the generated union.
    ...(socialProviders ? { socialProviders: socialProviders as never } : {}),
    // Shelf SSO providers are code-driven recipes; runtime provider
    // management stays off (see SSO_MANAGEMENT_PATHS).
    ...(options.sso ? { disabledPaths: SSO_MANAGEMENT_PATHS } : {}),
    session: { expiresIn, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: advancedOptions(options),
    databaseHooks: {
      user: {
        create: {
          after: async (created: unknown): Promise<void> => {
            await mirrorUser(db, created, options);
          },
        },
      },
    },
    plugins: buildPlugins(options, db),
  });
  // Narrowed to the shelf surface: handler mounting plus session reads.
  return auth;
}

/** The slice of Better Auth's `advanced` options the shelf sets. */
interface AdvancedOptions {
  database: { generateId: () => string };
  cookies: {
    session_token: { name: string; attributes: ReturnType<typeof sessionCookieAttributes> };
  };
  /** Attributes of every other cookie the library sets (OAuth `state`): `useSecureCookies: false` must not drop `Secure`. */
  defaultCookieAttributes?: { secure: true };
  /** Set to false for the `__Host-` cookie: the library would add `__Secure-` in front of the name. */
  useSecureCookies?: false;
}

/** Better Auth's `advanced` block: ULID ids and our session cookie (name and attributes). */
function advancedOptions(options: ShelfAuthOptions): AdvancedOptions {
  const attributes = sessionCookieAttributes(options.baseURL);
  if (options.hostSessionCookie === true) {
    // The library prefixes `__Secure-` to the name whenever it considers the cookie secure. Turning
    // that off and stating `secure: true` ourselves leaves the `__Host-` name as it is typed here.
    return {
      database: { generateId: (): string => ulid() },
      cookies: {
        session_token: { name: HOST_SESSION_COOKIE, attributes: { ...attributes, secure: true } },
      },
      useSecureCookies: false,
      defaultCookieAttributes: { secure: true },
    };
  }
  return {
    database: { generateId: (): string => ulid() },
    cookies: { session_token: { name: SESSION_COOKIE, attributes } },
  };
}

/**
 * The session cookie's attributes, stated here instead of left to Better Auth's defaults, so a
 * library upgrade cannot loosen them (`engine.test.ts` pins them). `SameSite=Lax` is what keeps a
 * cross-site form post from carrying the session to a cookie-authenticated write; `Secure` follows
 * the public URL (the app may sit behind a TLS-terminating proxy, so the request is not asked).
 */
function sessionCookieAttributes(baseURL: string): {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: new URL(baseURL).protocol === "https:",
  };
}
