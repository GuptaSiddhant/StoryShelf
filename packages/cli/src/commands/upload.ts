/* oxlint-disable max-statements, max-lines-per-function, complexity, eslint/max-statements, eslint/max-lines-per-function, eslint/complexity, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/prefer-nullish-coalescing, typescript/prefer-regexp-exec, eslint/no-await-in-loop, no-await-in-loop, max-depth, eslint/max-depth */
import AdmZip from "adm-zip";
import { createClient } from "../client.ts";
import { loadStorybookConfig } from "../config.ts";
import { createSpinner, printLine, spinnerFrames } from "../output.ts";

interface BuildResponse { id: string; }

/** Options for the `upload` command. */
export interface UploadOptions {
  /** Server base URL. */
  url?: string;
  /** Project slug. */
  slug?: string;
  /** CI token. */
  token?: string;
  /** Git commit SHA. */
  sha?: string;
  /** Git branch. */
  branch?: string;
  /** Built Storybook directory. Defaults to `storybook-static`. */
  storybookDir?: string;
  /** Commit message. */
  message?: string;
  /** Author email. */
  authorEmail?: string;
  /** Author name. */
  authorName?: string;
}

/**
 * Upload a built Storybook and create a build record.
 *
 * @param options - Upload command options.
 */
export async function runUpload(options: UploadOptions): Promise<void> {
  const cfg = await loadStorybookConfig();
  const url = options.url ?? cfg?.url ?? process.env["STORYSHELF_URL"];
  const slug = options.slug ?? cfg?.slug ?? process.env["STORYSHELF_SLUG"];
  const token = options.token ?? process.env["STORYSHELF_TOKEN"] ?? process.env["SHELF_TOKEN"];
  const sha = options.sha ?? process.env["GITHUB_SHA"] ?? process.env["VERCEL_GIT_COMMIT_SHA"] ?? process.env["CI_COMMIT_SHA"];
  const branch = options.branch ?? process.env["GITHUB_REF_NAME"] ?? process.env["VERCEL_GIT_COMMIT_REF"] ?? process.env["CI_COMMIT_REF_NAME"];
  const storybookDir = options.storybookDir ?? cfg?.storybookDir ?? "storybook-static";

  if (!url) throw new Error("--url is required (or .storybook/storyshelf.json / STORYSHELF_URL)");
  if (!slug) throw new Error("--slug is required (or .storybook/storyshelf.json / STORYSHELF_SLUG)");
  if (!token) throw new Error("--token is required (or STORYSHELF_TOKEN env)");
  if (!sha) throw new Error("--sha is required (or GITHUB_SHA env)");
  if (!branch) throw new Error("--branch is required (or GITHUB_REF_NAME env)");

  const zip = new AdmZip();
  zip.addLocalFolder(storybookDir);
  const zipBuffer = zip.toBuffer();

  const form = new FormData();
  form.set("gitSha", sha);
  form.set("gitBranch", branch);
  if (options.message) form.set("message", options.message);
  if (options.authorEmail) form.set("authorEmail", options.authorEmail);
  if (options.authorName) form.set("authorName", options.authorName);
  form.set("zip", new Blob([new Uint8Array(zipBuffer)], { type: "application/zip" }), "storybook.zip");

  const client = createClient(url, token);
  const spinner = createSpinner("Uploading...", spinnerFrames);
  try {
    const build = await client.projects.builds.create(slug, form);
    const buildData = build as BuildResponse;
    spinner.stop("Upload complete");
    printLine(`Build created: ${buildData.id}`);
  } catch (error) {
    spinner.stop("Upload failed");
    throw error;
  }
}
