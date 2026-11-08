/** API token, project member and group-mapping schemas. */
import { z } from "@hono/zod-openapi";
import { PROJECT_ROLES } from "@storyshelf/core/types";

/** OpenAPI schema for a public API token (hash omitted). */
export const tokenPublicSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    lastUsedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("Token");

/** OpenAPI schema for creating an API token. */
export const tokenCreateSchema = z.object({ name: z.string().min(1) }).openapi("TokenCreateInput");

/** OpenAPI schema for a newly created token including its secret value. */
export const tokenCreatedSchema = z
  .object({
    name: z.string(),
    token: z.string(),
  })
  .openapi("TokenCreated");

/** OpenAPI schema for a project member record. */
export const memberSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    userId: z.string(),
    role: z.enum(PROJECT_ROLES),
    createdAt: z.string(),
  })
  .openapi("ProjectMember");

/** OpenAPI schema for updating a member's role. */
export const memberRoleSchema = z
  .object({ role: z.enum(PROJECT_ROLES) })
  .openapi("MemberRoleInput");

/** OpenAPI schema for adding a member to a project. */
export const memberSetSchema = z
  .object({
    userId: z.string().min(1),
    role: z.enum(PROJECT_ROLES),
  })
  .openapi("MemberSetInput");

/** OpenAPI schema for an identity-provider group mapping. */
export const groupMappingSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    groupName: z.string(),
    role: z.enum(PROJECT_ROLES),
    createdAt: z.string(),
  })
  .openapi("GroupMapping");

/** OpenAPI schema for creating a group mapping. */
export const groupMappingCreateSchema = z
  .object({
    groupName: z.string().min(1),
    role: z.enum(PROJECT_ROLES),
  })
  .openapi("GroupMappingCreateInput");
