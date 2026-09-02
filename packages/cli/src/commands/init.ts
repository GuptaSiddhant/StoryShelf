/* oxlint-disable max-statements, max-lines-per-function, complexity, eslint/max-statements, eslint/max-lines-per-function, eslint/complexity, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/prefer-nullish-coalescing, eslint/no-await-in-loop, no-await-in-loop, max-depth, eslint/max-depth, eslint/no-useless-escape, no-useless-escape */
import prompts from "prompts";

import { createClient } from "../client.ts";
import { assertStorybookMain, detectStorybookMeta, loadStorybookConfig, writeStorybookConfig } from "../config.ts";
import { printError, printLine } from "../output.ts";

/** Options for the `init` command (client config). */
export interface InitOptions {
  /** Server base URL. */
  url?: string;
  /** Project slug. */
  slug?: string;
  /** Built Storybook directory. */
  buildDir?: string;
  /** Deprecated alias for buildDir. */
  storybookDir?: string;
  /** Build command. */
  buildCommand?: string;
  /** Build script name. */
  buildScriptName?: string;
  /** Skip pattern (glob). */
  skip?: string;
  /** Custom config file path. */
  config?: string;
  /** Token for sync (fallback to env). */
  token?: string;
}

/**
 * Initialize .storybook/storyshelf.json for the current Storybook.
 * Fails if .storybook/main.* is not found.
 *
 * @param options - Init command options.
 */
export async function runInit(options: InitOptions): Promise<void> {
  await assertStorybookMain();

  let url = options.url ?? process.env["STORYSHELF_URL"];
  let slug = options.slug ?? process.env["STORYSHELF_SLUG"];
  let buildDir = options.buildDir ?? options.storybookDir;
  let {buildCommand} = options;
  let {buildScriptName} = options;
  let {skip} = options;
  const configPath = options.config;

  const existing = await loadStorybookConfig(process.cwd(), configPath);
  if (existing) {
    url ??= existing.url;
    slug ??= existing.slug;
    buildDir ??= existing.buildDir;
    buildCommand ??= existing.buildCommand;
    buildScriptName ??= existing.buildScriptName;
    skip ??= existing.skip;
  }

  const meta = await detectStorybookMeta();
  const hintParts: string[] = [];
  if (meta.framework?.name) {hintParts.push(meta.framework.name);}
  if (meta.addons?.length) {hintParts.push(`${meta.addons.length} addons`);}
  if (meta.packagePath && meta.packagePath !== ".") {hintParts.push(meta.packagePath);}
  const hintSuffix = hintParts.length > 0 ? ` (detected ${hintParts.join(" • ")})` : "";

  const questions: { type: "text"; name: string; message: string; initial?: string }[] = [];
  if (!url) {
    questions.push({ type: "text", name: "url", message: `Server URL?${hintSuffix}` });
  }
  if (!slug) {
    questions.push({ type: "text", name: "slug", message: `Project slug?${hintSuffix}` });
  }

  if (questions.length > 0) {
    const answers = await prompts(questions);
    if (questions.some((question) => !answers[question.name])) {
      printError("Cancelled.");
      return;
    }
    url ??= answers["url"] as string | undefined;
    slug ??= answers["slug"] as string | undefined;
  }

  if (!slug) {
    printError("--slug is required (or run `storyshelf create --url <url> --name <name>`)");
    process.exitCode = 1;
    return;
  }

  const config: { slug: string; url?: string; buildDir?: string; buildCommand?: string; buildScriptName?: string; skip?: string } = { slug };
  if (url) {config.url = url;}
  if (buildDir) {config.buildDir = buildDir;}
  if (buildCommand) {config.buildCommand = buildCommand;}
  if (buildScriptName) {config.buildScriptName = buildScriptName;}
  if (skip) {config.skip = skip;}

  try {
    const written = await writeStorybookConfig(config, process.cwd(), options.config);
    printLine(`Wrote ${written}`);
    if (hintParts.length > 0) {
      printLine(`Detected ${hintParts.join(" • ")}`);
    }
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  // Sync storybook_meta to server if project already exists
  if (url && slug) {
    const metaToSync = await detectStorybookMeta();
    if (Object.keys(metaToSync).length === 0) {return;}
    const tokens = [
      options.token ?? process.env["STORYSHELF_TOKEN"] ?? process.env["SHELF_TOKEN"],
      process.env["STORYSHELF_ADMIN_TOKEN"] ?? process.env["ADMIN_TOKEN"],
    ].filter(Boolean) as string[];
    if (tokens.length === 0) {return;}
    let synced = false;
    let notFound = false;
    for (const token of tokens) {
      const client = createClient(url, token);
      try {
        await client.projects.get(slug);
        // Project exists, try patch
        try {
          await client.projects.update(slug, { storybookMeta: metaToSync });
          printLine(`Synced storybook_meta for ${slug}`);
          synced = true;
          break;
        } catch (error) {
          // Patch may fail due to auth (project token not admin), try next token
          if (error instanceof Error && error.message.includes("403")) {continue;}
          throw error;
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("404")) {
          notFound = true;
          break;
        }
        if (error instanceof Error && error.message.includes("403")) {
          continue;
        }
        // Network or other error, try next token
        continue;
      }
    }
    if (!synced && notFound) {
      printError(`Project "${slug}" does not exist on ${url} — run \`storyshelf create --url ${url} --name <name> --token \$STORYSHELF_ADMIN_TOKEN\` first`);
      process.exitCode = 1;
    }
  }
}
