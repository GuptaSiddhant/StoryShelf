import { createClient } from "../client.ts";
import { printLine } from "../output.ts";

/** Options for the `init` command. */
export interface InitOptions {
  /** Server base URL. */
  url: string;
  /** Project name. */
  name: string;
}

interface ProjectResponse { slug: string; }
interface TokenResponse { token: string; }

/**
 * Create a project and CI token on a StoryShelf server.
 *
 * @param options - Init command options.
 */
export async function runInit(options: InitOptions): Promise<void> {
  const client = createClient(options.url);
  const project = await client.projects.create({ name: options.name });
  const projectData = project as ProjectResponse;
  const token = await client.projects.tokens.create(projectData.slug, { name: "ci" });
  const tokenData = token as TokenResponse;
  printLine(`Project slug: ${projectData.slug}`);
  printLine(`CI token: ${tokenData.token}`);
}
