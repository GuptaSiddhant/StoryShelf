/**
 * The CLI's project config: `.storybook/storyshelf.json` (schema, loading and writing), what
 * `init` proposes from the project (defaults) and the package runner of the environment. This
 * module keeps the public surface; the code lives in `config/`.
 */
export type { StorybookConfig, SchemaReferenceOptions } from "./config/schema.ts";
export { cliVersion, schemaReference } from "./config/schema.ts";
export type { WriteConfigOptions } from "./config/load.ts";
export {
  assertStorybookMain,
  findStorybookMain,
  loadStorybookConfig,
  writeStorybookConfig,
} from "./config/load.ts";
export type { StorybookMeta } from "./config/defaults.ts";
export {
  detectGitDefaultBranch,
  detectGitRepository,
  detectPackageName,
  detectPackagePath,
  detectStorybookMeta,
} from "./config/defaults.ts";
export type { PackageRunner } from "./config/env.ts";
export { detectPackageRunner, installCommand, startCommand } from "./config/env.ts";
