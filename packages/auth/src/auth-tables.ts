/**
 * Auth table definitions: drizzle handles for the Better Auth base models.
 *
 * Keys are camelCase (repo convention); columns snake_case. Field names match
 * Better Auth defaults exactly, so the bridge needs no name translation.
 * Custom modelName/fieldName options are unsupported in v1 (fail fast).
 * DDL for drivers is vendored separately (see E3); these defs are the source
 * of truth the DDL must match (the strict schema checker enforces it).
 */
import { integer, sqliteTable, text } from "@storyshelf/core/orm/sqlite-core";

/** Narrow `user` table definition (Better Auth base model). */
export const authUser = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Narrow `session` table definition (Better Auth base model). */
export const authSession = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Narrow `account` table definition (Better Auth base model). */
export const authAccount = sqliteTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: text("access_token_expires_at"),
  refreshTokenExpiresAt: text("refresh_token_expires_at"),
  scope: text("scope"),
  expiresAt: text("expires_at"),
  password: text("password"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Narrow `verification` table definition (Better Auth base model). */
export const authVerification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Narrow `passkey` table definition (passkey plugin model). */ export const authPasskey =
  sqliteTable("passkey", {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: integer("backed_up", { mode: "boolean" }).notNull().default(false),
    transports: text("transports"),
    aaguid: text("aaguid"),
    createdAt: text("created_at").notNull(),
    // Nullable by design: the plugin's verify-registration create omits
    // `updatedAt` (its model schema has no such field), so the bridge writes
    // null. Counter updates never touch it either.
    updatedAt: text("updated_at"),
  });

/** Narrow `ssoProvider` table definition (SSO plugin model). */
export const authSsoProvider = sqliteTable("ssoProvider", {
  id: text("id").primaryKey(),
  issuer: text("issuer").notNull(),
  oidcConfig: text("oidc_config"),
  samlConfig: text("saml_config"),
  userId: text("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  providerId: text("provider_id").notNull().unique(),
  organizationId: text("organization_id"),
  domain: text("domain").notNull(),
});

/** Table handles for the Better Auth base models, keyed by model name. */
export const baseAuthTables = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  passkey: authPasskey,
  ssoProvider: authSsoProvider,
};

/** Date-valued fields per base model (ISO strings at rest, Dates in flight). */
export const baseAuthDateFields: Record<string, string[]> = {
  user: ["createdAt", "updatedAt"],
  session: ["expiresAt", "createdAt", "updatedAt"],
  account: ["accessTokenExpiresAt", "refreshTokenExpiresAt", "expiresAt", "createdAt", "updatedAt"],
  verification: ["expiresAt", "createdAt", "updatedAt"],
  passkey: ["createdAt", "updatedAt"],
  // No timestamps: the SSO plugin never writes them (register create sends
  // no createdAt/updatedAt; defaultSSO entries write no rows at all).
  ssoProvider: [],
};
