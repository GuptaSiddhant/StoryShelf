// Minimal `pg` (node-postgres) surface used by `./pg`. Declared locally so
// the preset typechecks without the `@types/pg` package — deliberately so:
// drizzle-orm resolves a distinct copy per unique peer set, and a
// per-package `@types/*` dep would split the shared `Table`/`SQL` types (see
// `db-sqlite` README). Never add drizzle-orm peer packages as direct deps of
// a single workspace package. Global (non-module) file so the declaration is
// ambient rather than an augmentation.
declare module "pg" {
  export interface PgQueryResult {
    rows: unknown[];
  }
  export interface PgClientBase {
    query(text: string, params?: unknown[]): Promise<PgQueryResult>;
  }
  export interface PoolClient extends PgClientBase {
    release(): void;
  }
  export interface Client extends PgClientBase {
    connect(): Promise<void>;
    end(): Promise<void>;
  }
  export interface PoolConfig {
    connectionString?: string;
    ssl?: unknown;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  }
  export class Pool implements PgClientBase {
    constructor(config?: PoolConfig);
    query(text: string, params?: unknown[]): Promise<PgQueryResult>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}
