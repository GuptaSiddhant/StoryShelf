/**
 * The credential tables: CI tokens, local-account invite tokens and users' OAuth connections, as
 * neutral tables. Every secret is stored hashed or encrypted.
 */
import { id, key, text, timestamp } from "../columns.ts";
import { defineTable, index, uniqueIndex } from "../define-table.ts";

export const tokens = defineTable("tokens", {
  id: id("id").primaryKey(),
  projectId: id("project_id").notNull().references("projects", "id", "cascade"),
  name: text("name").notNull(),
  hash: key("hash", 128).notNull().unique(),
  userId: id("user_id").references("users", "id", "cascade"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull(),
});

export const userInviteTokens = defineTable(
  "user_invite_tokens",
  {
    id: id("id").primaryKey(),
    userId: id("user_id").notNull().references("users", "id", "cascade"),
    tokenHash: key("token_hash", 128).notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull(),
  },
  { indexes: [index("user_invite_tokens_user_id_idx", ["userId"])] },
);

export const userConnections = defineTable(
  "user_connections",
  {
    id: id("id").primaryKey(),
    userId: id("user_id").notNull().references("users", "id", "cascade"),
    service: key("service", 64).notNull(),
    tokenEncrypted: text("token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    expiresAt: timestamp("expires_at"),
    status: key("status", 32).notNull().default("ok"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  { indexes: [uniqueIndex("user_connections_user_service_idx", ["userId", "service"])] },
);
