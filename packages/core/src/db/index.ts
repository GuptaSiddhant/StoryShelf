/**
 * `@storyshelf/core/db`: the neutral schema layer (ADR 0041 decision 2). Each table is defined once
 * here with `defineTable`; each database adapter's table factory builds it as a Drizzle table.
 */
export {
  bigint,
  bool,
  double,
  enumOf,
  id,
  int,
  json,
  key,
  NeutralColumn,
  text,
  timestamp,
  toJsonText,
  type AnyNeutralColumn,
  type ColumnKind,
  type ColumnReference,
  type ColumnSpec,
  type DefaultValue,
  type OnDelete,
} from "./columns.ts";
export {
  defineTable,
  index,
  uniqueIndex,
  type CheckSpec,
  type ColumnData,
  type IndexSpec,
  type InferRow,
  type NeutralTable,
  type PrimaryKeySpec,
  type TableExtras,
} from "./define-table.ts";
export {
  applyFlags,
  buildAll,
  foreignKeysOf,
  jsonCodec,
  referencedColumn,
  resolverOf,
  withJsonInsertDefault,
  type FlaggedBuilder,
  type InsertDefaultBuilder,
  type ForeignKeyPlan,
  type ModifiableBuilder,
  type TableResolver,
} from "./dialect-kit.ts";
export {
  tableExtras,
  type ConstraintNames,
  type DialectBuilders,
  type ExtrasInput,
} from "./table-extras.ts";
export {
  buildContentReleases,
  buildDeletions,
  buildLabels,
  buildReferenceGenerations,
  buildReferences,
  builds,
  labelTypes,
  NEUTRAL_TABLES,
  projectGroupMappings,
  projectLinks,
  projectMembers,
  projects,
  users,
} from "./tables/index.ts";
