/**
 * The Better Auth tables (base models plus the passkey and SSO plugins) as neutral tables. Their
 * SQL names and column keys are Better Auth's own, so the bridge needs no name translation. Not
 * wired into any adapter: the hand-written tables in `@storyshelf/auth` and `ddl.ts` stay
 * authoritative.
 */
import { bool, id, int, key, text, timestamp, type NeutralColumn } from "../columns.ts";
import { defineTable, index } from "../define-table.ts";

const userId = (): NeutralColumn<string, true> =>
  id("user_id").notNull().references("user", "id", "cascade");
const createdAt = (): NeutralColumn<string, true> => timestamp("created_at").notNull();
const updatedAt = (): NeutralColumn<string, true> => timestamp("updated_at").notNull();

/** A Better Auth user. */
export const authUser = defineTable("user", {
  id: id("id").primaryKey(),
  name: text("name").notNull(),
  email: key("email", 255).notNull().unique(),
  emailVerified: bool("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A signed-in session, found by its token. */
export const authSession = defineTable(
  "session",
  {
    id: id("id").primaryKey(),
    userId: userId(),
    token: key("token", 512).notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  {
    indexes: [index("session_token_idx", ["token"]), index("session_user_id_idx", ["userId"])],
  },
);

/** A user's credential with one provider: a password or an identity provider's tokens. */
export const authAccount = defineTable(
  "account",
  {
    id: id("id").primaryKey(),
    userId: userId(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    expiresAt: timestamp("expires_at"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  { indexes: [index("account_user_id_idx", ["userId"])] },
);

/** A short-lived verification value (email link, state) keyed by its identifier. */
export const authVerification = defineTable(
  "verification",
  {
    id: id("id").primaryKey(),
    identifier: key("identifier", 255).notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  { indexes: [index("verification_identifier_idx", ["identifier"])] },
);

/** A WebAuthn passkey (passkey plugin). */
export const authPasskey = defineTable(
  "passkey",
  {
    id: id("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: userId(),
    credentialID: key("credential_id", 255).notNull(),
    counter: int("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: bool("backed_up").notNull().default(false),
    transports: text("transports"),
    aaguid: text("aaguid"),
    createdAt: createdAt(),
    // Nullable: the plugin's registration create sends no `updatedAt`.
    updatedAt: timestamp("updated_at"),
  },
  {
    indexes: [
      index("passkey_user_id_idx", ["userId"]),
      index("passkey_credential_id_idx", ["credentialID"]),
    ],
  },
);

/** An OIDC or SAML identity provider registered for a domain (SSO plugin). */
export const authSsoProvider = defineTable(
  "ssoProvider",
  {
    id: id("id").primaryKey(),
    issuer: text("issuer").notNull(),
    oidcConfig: text("oidc_config"),
    samlConfig: text("saml_config"),
    userId: userId(),
    providerId: key("provider_id", 64).notNull().unique(),
    organizationId: text("organization_id"),
    domain: key("domain", 255).notNull(),
  },
  { indexes: [index("ssoprovider_domain_idx", ["domain"])] },
);
