/** The tables defined once in core (ADR 0041); the rest are still hand-written per dialect. */
import {
  buildContentReleases,
  buildDeletions,
  buildReferenceGenerations,
  buildReferences,
  builds,
} from "./build.ts";
import { buildLabels, labelTypes } from "./label.ts";
import { projectGroupMappings, projectLinks, projectMembers, projects } from "./project.ts";
import { users } from "./user.ts";

export {
  buildContentReleases,
  buildDeletions,
  buildLabels,
  buildReferenceGenerations,
  buildReferences,
  builds,
  labelTypes,
  projectGroupMappings,
  projectLinks,
  projectMembers,
  projects,
  users,
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
] as const;
