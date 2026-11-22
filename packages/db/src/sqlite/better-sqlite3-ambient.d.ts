// Minimal `better-sqlite3` surface used by `./better-sqlite3`. Declared
// locally so the preset typechecks without the `@types/better-sqlite3`
// package — deliberately so: drizzle-orm resolves a distinct copy per unique
// peer set, and a per-package `@types/*` dep would split the shared
// `drizzle-orm` types (duplicate `Table`/`SQL` identities). Never add any of
// drizzle-orm's peer packages as a direct dep of a single workspace package;
// use ambient declarations instead. Global (non-module) file so the
// declaration is ambient rather than an augmentation.
declare module "better-sqlite3" {
  export interface BetterSqlite3Statement {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
    raw(toggleState?: boolean): BetterSqlite3Statement;
  }
  export interface BetterSqlite3Options {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: (...params: unknown[]) => void;
  }
  export default class Database {
    constructor(path?: string, options?: BetterSqlite3Options);
    exec(sql: string): void;
    prepare(sql: string): BetterSqlite3Statement;
    close(): void;
  }
}
