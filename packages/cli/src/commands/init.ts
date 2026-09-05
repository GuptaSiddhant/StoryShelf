import prompts from "prompts";
import { createClient } from "../client.ts";
import {
  assertStorybookMain,
  detectStorybookMeta,
  loadStorybookConfig,
  type StorybookConfig,
  type StorybookMeta,
  writeStorybookConfig,
} from "../config.ts";
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
  /** Working directory (defaults to process.cwd()). Test seam for fs access. */
  cwd?: string;
}

interface InitAnswers {
  url?: string;
  slug?: string;
  buildDir?: string;
  buildCommand?: string;
  buildScriptName?: string;
  skip?: string;
  detected: string;
}

/** Human description of the detected Storybook (framework, addons, path). */
function describeMeta(meta: StorybookMeta): string {
  const hintParts: string[] = [];
  if (meta.framework?.name) {
    hintParts.push(meta.framework.name);
  }
  if (meta.addons?.length) {
    hintParts.push(`${meta.addons.length} addons`);
  }
  if (meta.packagePath && meta.packagePath !== ".") {
    hintParts.push(meta.packagePath);
  }
  return hintParts.join(" • ");
}

type PromptName = "url" | "slug";

function buildQuestions(url: string | undefined, slug: string | undefined, hint: string): {
  type: "text";
  name: PromptName;
  message: string;
}[] {
  const questions: { type: "text"; name: PromptName; message: string }[] = [];
  if (!url) {
    questions.push({ type: "text", name: "url", message: `Server URL?${hint}` });
  }
  if (!slug) {
    questions.push({ type: "text", name: "slug", message: `Project slug?${hint}` });
  }
  return questions;
}

interface PromptAnswers {
  url?: unknown;
  slug?: unknown;
}

/** Prompt for whichever of url/slug is still missing; null when cancelled. */
async function promptMissing(
  url: string | undefined,
  slug: string | undefined,
  hintSuffix: string,
): Promise<PromptAnswers | null> {
  const questions = buildQuestions(url, slug, hintSuffix);
  if (questions.length === 0) {
    return {};
  }
  const answers = (await prompts(questions)) as PromptAnswers;
  if (questions.some((question) => !answers[question.name])) {
    printError("Cancelled.");
    return null;
  }
  return answers;
}

function narrowAnswer(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

interface MergedInitOptions {
  url?: string;
  slug?: string;
  buildDir?: string;
  buildCommand?: string;
  buildScriptName?: string;
  skip?: string;
}

/** Layer explicit options over an existing config file. */
function mergeWithExisting(options: InitOptions, existing: StorybookConfig | null): MergedInitOptions {
  const url = options.url ?? process.env["STORYSHELF_URL"];
  const slug = options.slug ?? process.env["STORYSHELF_SLUG"];
  if (!existing) {
    return {
      url,
      slug,
      buildDir: options.buildDir ?? options.storybookDir,
      buildCommand: options.buildCommand,
      buildScriptName: options.buildScriptName,
      skip: options.skip,
    };
  }
  return {
    url: url ?? existing.url,
    slug: slug ?? existing.slug,
    buildDir: (options.buildDir ?? options.storybookDir) ?? existing.buildDir,
    buildCommand: options.buildCommand ?? existing.buildCommand,
    buildScriptName: options.buildScriptName ?? existing.buildScriptName,
    skip: options.skip ?? existing.skip,
  };
}

/** Resolve init answers from options, existing config, and prompts. */
async function resolveInitAnswers(options: InitOptions, cwd: string): Promise<InitAnswers | null> {
  const existing = await loadStorybookConfig(cwd, options.config);
  const merged = mergeWithExisting(options, existing);
  const detected = describeMeta(await detectStorybookMeta(cwd));
  const hintSuffix = detected ? ` (detected ${detected})` : "";
  const answers = await promptMissing(merged.url, merged.slug, hintSuffix);
  if (!answers) {
    return null;
  }
  return { ...merged, url: narrowAnswer(answers.url) ?? merged.url, slug: narrowAnswer(answers.slug) ?? merged.slug, detected };
}

interface InitConfig {
  slug: string;
  url?: string;
  buildDir?: string;
  buildCommand?: string;
  buildScriptName?: string;
  skip?: string;
}

const OPTIONAL_INIT_KEYS = ["url", "buildDir", "buildCommand", "buildScriptName", "skip"] as const;

function buildInitConfig(answers: InitAnswers, slug: string): InitConfig {
  const config: InitConfig = { slug };
  for (const key of OPTIONAL_INIT_KEYS) {
    const value = answers[key];
    if (value) {
      config[key] = value;
    }
  }
  return config;
}

/** Persist the resolved answers to .storybook/storyshelf.json. */
async function persistInitConfig(
  answers: InitAnswers,
  slug: string,
  cwd: string,
  configPath?: string,
): Promise<void> {
  try {
    const written = await writeStorybookConfig(buildInitConfig(answers, slug), cwd, configPath);
    printLine(`Wrote ${written}`);
    if (answers.detected) {
      printLine(`Detected ${answers.detected}`);
    }
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function isProviderError(error: unknown, status: string): boolean {
  return error instanceof Error && error.message.includes(status);
}

type SyncOutcome = "synced" | "not-found" | "next";

/** Fetch the project; classify get-phase failures. */
async function fetchProjectForSync(url: string, token: string, slug: string): Promise<SyncOutcome> {
  try {
    await createClient(url, token).projects.get(slug);
    return "synced";
  } catch (error) {
    if (isProviderError(error, "404")) {
      return "not-found";
    }
    return "next";
  }
}

/** Patch storybook_meta; 403 means the token lacks admin (try next). */
async function patchProjectMeta(
  url: string,
  token: string,
  slug: string,
  metaToSync: StorybookMeta,
): Promise<SyncOutcome> {
  try {
    await createClient(url, token).projects.update(slug, { storybookMeta: metaToSync });
    return "synced";
  } catch (error) {
    if (isProviderError(error, "403")) {
      return "next";
    }
    throw error;
  }
}

/** Try syncing storybook_meta with one token. */
async function trySyncToken(
  url: string,
  token: string,
  slug: string,
  metaToSync: StorybookMeta,
): Promise<SyncOutcome> {
  const fetched = await fetchProjectForSync(url, token, slug);
  if (fetched !== "synced") {
    return fetched;
  }
  return await patchProjectMeta(url, token, slug, metaToSync);
}

/** Candidate tokens for the meta sync, in try order. */
function collectSyncTokens(token?: string): string[] {
  return [
    token ?? process.env["STORYSHELF_TOKEN"] ?? process.env["SHELF_TOKEN"],
    process.env["STORYSHELF_ADMIN_TOKEN"] ?? process.env["ADMIN_TOKEN"],
  ].filter((candidate): candidate is string => Boolean(candidate));
}

/** Try each token in order until sync, not-found, or exhaustion. */
async function runTokenLoop(
  url: string,
  slug: string,
  metaToSync: StorybookMeta,
  tokens: string[],
): Promise<{ synced: boolean; notFound: boolean }> {
  for (const candidate of tokens) {
    // eslint-disable-next-line no-await-in-loop -- try tokens in order, stop at first success
    const outcome = await trySyncToken(url, candidate, slug, metaToSync);
    if (outcome === "synced") {
      printLine(`Synced storybook_meta for ${slug}`);
      return { synced: true, notFound: false };
    }
    if (outcome === "not-found") {
      return { synced: false, notFound: true };
    }
  }
  return { synced: false, notFound: false };
}

/** Sync storybook_meta to the server when the project already exists. */
async function syncStorybookMeta(url: string, slug: string, cwd: string, token?: string): Promise<void> {
  const metaToSync = await detectStorybookMeta(cwd);
  if (Object.keys(metaToSync).length === 0) {
    return;
  }
  const tokens = collectSyncTokens(token);
  if (tokens.length === 0) {
    return;
  }
  const { synced, notFound } = await runTokenLoop(url, slug, metaToSync, tokens);
  if (!synced && notFound) {
    printError(
      `Project "${slug}" does not exist on ${url} — run \`storyshelf create --url ${url} --name <name> --token $STORYSHELF_ADMIN_TOKEN\` first`,
    );
    process.exitCode = 1;
  }
}

/** Write the config and sync meta once the slug is known. */
async function finalizeInit(answers: InitAnswers, cwd: string, options: InitOptions): Promise<void> {
  if (!answers.slug) {
    printError("--slug is required (or run `storyshelf create --url <url> --name <name>`)");
    process.exitCode = 1;
    return;
  }
  await persistInitConfig(answers, answers.slug, cwd, options.config);
  if (answers.url) {
    await syncStorybookMeta(answers.url, answers.slug, cwd, options.token);
  }
}

/**
 * Initialize .storybook/storyshelf.json for the current Storybook.
 * Fails if .storybook/main.* is not found.
 *
 * @param options - Init command options.
 */
export async function runInit(options: InitOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  await assertStorybookMain(cwd);
  const answers = await resolveInitAnswers(options, cwd);
  if (!answers) {
    return;
  }
  await finalizeInit(answers, cwd, options);
}
