import type { ShelfOptions } from "@storyshelf/core/config";

/** The environment a factory reads: `process.env` once the bin has loaded `.env`. */
export type InstanceEnv = Readonly<Record<string, string | undefined>>;

/** Builds the options of an instance. May throw (a missing setting): `doctor` reports it. */
export type ShelfInstanceFactory = (env: InstanceEnv) => ShelfOptions | Promise<ShelfOptions>;

/** What `afterSetup` receives: the options the factory returned and the environment. */
export interface ShelfInstanceContext {
  options: ShelfOptions;
  env: InstanceEnv;
}

/** Hooks of an instance definition. */
export interface ShelfInstanceHooks {
  /**
   * Work that needs the migrated database, e.g. ensuring the password admin. Only `storyshelf-server
   * serve` runs it, after setup and before the port opens; `migrate`, `doctor`, `purge` and
   * `check-storage` never do.
   */
  afterSetup?: (context: ShelfInstanceContext) => Promise<void> | void;
}

const BRAND = Symbol.for("storyshelf.instance-definition");

/** An instance definition: the default export of an instance module. */
export interface ShelfInstance extends ShelfInstanceHooks {
  readonly [BRAND]: true;
  readonly factory: ShelfInstanceFactory;
}

/**
 * Define an instance: the default export of the module `storyshelf-server` loads. The module
 * exports configuration, never a constructed app: the bin loads `.env`, refuses renamed settings,
 * calls the factory and creates the app for the command it runs (`serve`, `migrate` or a tool).
 *
 * ```ts
 * export default defineShelfInstance(async (env) => ({ database, storage, config: { ... } }));
 * ```
 */
export function defineShelfInstance(
  factory: ShelfInstanceFactory,
  hooks: ShelfInstanceHooks = {},
): ShelfInstance {
  return { [BRAND]: true, factory, ...hooks };
}

/** Whether `value` is an instance definition (by brand, so a second copy of this package counts). */
export function isShelfInstance(value: unknown): value is ShelfInstance {
  return (
    typeof value === "object" && value !== null && (value as { [BRAND]?: true })[BRAND] === true
  );
}
