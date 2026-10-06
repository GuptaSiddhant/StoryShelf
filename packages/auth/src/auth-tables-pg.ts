/**
 * Auth table definitions for Postgres (pg-core mirrors of `auth-tables.ts`).
 *
 * Same model names, same camelCase keys, same snake_case columns; timestamps
 * ride `timestamp(..., { mode: "string" })` so the bridge keeps exchanging
 * ISO strings, booleans ride native `boolean`. The bridge consumes either
 * dialect through the shared {@link AuthBridgeSchema} registry.
 */
import { boolean, integer, pgTable, text, timestamp } from "@storyshelf/core/orm/pg-core";

/** Narrow `user` table definition (Better Auth base model). */
export const authUserPg = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

/** Narrow `session` table definition (Better Auth base model). */
export const authSessionPg = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => authUserPg.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

/** Narrow `account` table definition (Better Auth base model). */
export const authAccountPg = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => authUserPg.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
    mode: "string",
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
    mode: "string",
  }),
  scope: text("scope"),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

/** Narrow `verification` table definition (Better Auth base model). */
export const authVerificationPg = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

/** Narrow `passkey` table definition (passkey plugin model). */
export const authPasskeyPg = pgTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => authUserPg.id, { onDelete: "cascade" }),
  credentialID: text("credential_id").notNull(),
  counter: integer("counter").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull().default(false),
  transports: text("transports"),
  aaguid: text("aaguid"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  // Nullable like sqlite: the plugin's registration create omits updatedAt.
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }),
});

/** Narrow `ssoProvider` table definition (SSO plugin model). */
export const authSsoProviderPg = pgTable("ssoProvider", {
  id: text("id").primaryKey(),
  issuer: text("issuer").notNull(),
  oidcConfig: text("oidc_config"),
  samlConfig: text("saml_config"),
  userId: text("user_id")
    .notNull()
    .references(() => authUserPg.id, { onDelete: "cascade" }),
  providerId: text("provider_id").notNull().unique(),
  organizationId: text("organization_id"),
  domain: text("domain").notNull(),
});

/** Table handles for the Better Auth base models, keyed by model name. */
export const baseAuthTablesPg = {
  user: authUserPg,
  session: authSessionPg,
  account: authAccountPg,
  verification: authVerificationPg,
  passkey: authPasskeyPg,
  ssoProvider: authSsoProviderPg,
};

/** Date-valued fields per base model (ISO strings at rest, Dates in flight). */
export const baseAuthDateFieldsPg: Record<string, string[]> = {
  user: ["createdAt", "updatedAt"],
  session: ["expiresAt", "createdAt", "updatedAt"],
  account: ["accessTokenExpiresAt", "refreshTokenExpiresAt", "expiresAt", "createdAt", "updatedAt"],
  verification: ["expiresAt", "createdAt", "updatedAt"],
  passkey: ["createdAt", "updatedAt"],
  ssoProvider: [],
};
