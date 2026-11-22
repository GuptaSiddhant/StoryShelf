/** The tables defined once in core (ADR 0041); the rest are still hand-written per dialect. */
import { tokens, userConnections, userInviteTokens } from "./access.ts";
import {
  buildContentReleases,
  buildDeletions,
  buildReferenceGenerations,
  buildReferences,
  builds,
} from "./build.ts";
import { captureAttempts, captureJobs, captureLogs, captureShards } from "./capture.ts";
import { buildLabels, labelTypes } from "./label.ts";
import { notificationChannels, notificationSubscriptions, webhooks } from "./notification.ts";
import { projectGroupMappings, projectLinks, projectMembers, projects } from "./project.ts";
import { schemaMeta, siteSettings } from "./settings.ts";
import { users } from "./user.ts";

export {
  buildContentReleases,
  buildDeletions,
  buildLabels,
  buildReferenceGenerations,
  buildReferences,
  builds,
  captureAttempts,
  captureJobs,
  captureLogs,
  captureShards,
  labelTypes,
  notificationChannels,
  notificationSubscriptions,
  projectGroupMappings,
  projectLinks,
  projectMembers,
  projects,
  schemaMeta,
  siteSettings,
  tokens,
  userConnections,
  userInviteTokens,
  users,
  webhooks,
};

/** Every neutral table, parents before children, for `buildAll`. */
export const NEUTRAL_TABLES = [
  projects,
  users,
  projectMembers,
  projectGroupMappings,
  projectLinks,
  builds,
  labelTypes,
  buildLabels,
  buildReferences,
  buildReferenceGenerations,
  buildDeletions,
  buildContentReleases,
  siteSettings,
  schemaMeta,
  tokens,
  userInviteTokens,
  userConnections,
  webhooks,
  notificationChannels,
  notificationSubscriptions,
  captureJobs,
  captureAttempts,
  captureLogs,
  captureShards,
] as const;
