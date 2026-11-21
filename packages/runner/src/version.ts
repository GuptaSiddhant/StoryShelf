/** The `playwright-core` this runner drives browsers with. */
import { createRequire } from "node:module";

let cached: string | undefined;

/** Its version, for the connect-time mismatch error and for services that ask the client's version. */
export function playwrightVersion(): string {
  cached ??= (createRequire(import.meta.url)("playwright-core/package.json") as { version: string })
    .version;
  return cached;
}
