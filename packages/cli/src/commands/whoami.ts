import { createClient } from "../client.ts";
import { printLine } from "../output.ts";
import { resolveConnection, type ConnectionOptions } from "./connection.ts";

interface ProjectSummary {
  name?: unknown;
  slug?: unknown;
}

/**
 * Verify the token against the server and print the project it can read.
 *
 * @param options - Connection options (url/slug/token via flags, config, or env).
 */
export async function runWhoami(options: ConnectionOptions): Promise<void> {
  const { url, slug, token } = await resolveConnection(options);
  const project = (await createClient(url, token).projects.get(slug)) as ProjectSummary;
  const name = typeof project.name === "string" && project.name.length > 0 ? project.name : slug;
  printLine(`Server: ${url}`);
  printLine(`Project: ${name} (${slug})`);
}
