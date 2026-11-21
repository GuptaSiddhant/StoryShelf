/** The neutral tables of spike #800. */
import {
  buildContentReleases,
  buildDeletions,
  buildReferenceGenerations,
  buildReferences,
  builds,
} from "./build.ts";
import { buildLabels, labelTypes } from "./label.ts";
import { users } from "./user.ts";

export {
  buildContentReleases,
  buildDeletions,
  buildLabels,
  buildReferenceGenerations,
  buildReferences,
  builds,
  labelTypes,
  users,
};

/** Every spike table, parents before children, for `buildAll`. */
export const SPIKE_TABLES = [
  users,
  builds,
  labelTypes,
  buildLabels,
  buildReferences,
  buildReferenceGenerations,
  buildDeletions,
  buildContentReleases,
] as const;
