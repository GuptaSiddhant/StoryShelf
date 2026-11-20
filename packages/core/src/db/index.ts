/**
 * The neutral schema layer (ADR 0041 decision 2), spike #800. Not wired into any adapter yet; it
 * reaches the adapters' table factories through `@storyshelf/core/test-helpers` until task 3
 * gives it a subpath of its own.
 */
export {
  bigint,
  bool,
  enumOf,
  id,
  int,
  json,
  key,
  NeutralColumn,
  text,
  timestamp,
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
  referencedColumn,
  resolverOf,
  type FlaggedBuilder,
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
  SPIKE_TABLES,
  users,
} from "./tables/index.ts";
