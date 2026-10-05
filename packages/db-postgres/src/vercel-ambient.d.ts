// Minimal `@vercel/postgres` surface used by `./vercel`. Declared locally
// so the preset typechecks without relying on the package's type
// conditions; under Vercel (or with the peer installed) the real client (a
// superset) flows through at runtime. Global (non-module) file so the
// declaration is ambient rather than an augmentation.
declare module "@vercel/postgres" {
  export interface VercelQueryResult {
    rows: unknown[];
  }
  export interface VercelClient {
    query(text: string, params?: unknown[]): Promise<VercelQueryResult>;
    end(): Promise<void>;
  }
  export const sql: VercelClient & {
    connect(): Promise<VercelClient>;
  };
}
