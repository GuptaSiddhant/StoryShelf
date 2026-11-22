// Minimal `bun:sqlite` surface used by `./bun-sqlite`. Declared locally so the
// preset typechecks without the `bun-types` package; under Bun the real
// builtin (a superset) flows through at runtime. Global (non-module) file so
// the declaration is ambient rather than an augmentation.
declare module "bun:sqlite" {
  export interface BunStatement {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  }
  export interface BunDatabaseOptions {
    readonly?: boolean;
    create?: boolean;
    readwrite?: boolean;
  }
  export class Database {
    constructor(path?: string, options?: BunDatabaseOptions);
    exec(sql: string): void;
    query(sql: string): BunStatement;
    close(): void;
  }
}
