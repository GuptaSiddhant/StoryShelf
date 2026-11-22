// Minimal `@aws-sdk/rds-signer` surface used by `./rds-iam`. Declared locally so the preset
// typechecks without the optional peer installed (see `pg-ambient.d.ts`).
declare module "@aws-sdk/rds-signer" {
  export class Signer {
    constructor(config: { hostname: string; port: number; username: string; region: string });
    getAuthToken(): Promise<string>;
  }
}
