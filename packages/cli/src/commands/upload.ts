import AdmZip from "adm-zip";
import { normalizeBaseUrl } from "../client.ts";
import { printLine, createSpinner } from "../output.ts";

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface UploadOptions {
  url: string;
  slug: string;
  token: string;
  sha: string;
  branch: string;
  storybookDir?: string;
  message?: string;
  authorEmail?: string;
  authorName?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface UploadOptions {
  url: string;
  slug: string;
  token: string;
  sha: string;
  branch: string;
  storybookDir?: string;
  message?: string;
  authorEmail?: string;
  authorName?: string;
}

export async function runUpload(options: UploadOptions): Promise<void> {
  const storybookDir = options.storybookDir ?? "storybook-static";
  const base = normalizeBaseUrl(options.url);

  // Create zip archive
  const spinner = createSpinner("Creating zip archive...");
  const zip = new AdmZip();
  zip.addLocalFolder(options.storybookDir ?? "storybook-static");
  const zipBuffer = zip.toBuffer();
  printLine(`Zip created: ${formatBytes(zipBuffer.length)}`);

  const base = normalizeBaseUrl(options.url);
  const form = new FormData();
  form.set("gitSha", options.sha);
  form.set("gitBranch", options.branch);
  if (options.message) form.set("message", options.message);
  if (options.authorEmail) form.set("authorEmail", options.authorEmail);
  if (options.authorName) form.set("authorName", options.authorName);
  
  const zipBuffer = zip.toBuffer();
  const blob = new Blob([zipBuffer], { type: "application/zip" });
  const form = new FormData();
  form.set("gitSha", options.sha);
  form.set("gitBranch", options.branch);
  if (options.message) form.set("message", options.message);
  if (options.authorEmail) form.set("authorEmail", options.authorEmail);
  if (options.authorName) form.set("authorName", options.authorName);
  form.set("zip", new Blob([zipBuffer], { type: "application/zip" }), "storybook.zip");

  const spinner = createSpinner(`Uploading ${formatBytes(zipBuffer.length)}...`);
  
  // Create a progress-tracking fetch
  const response = await uploadWithProgress(
    `${normalizeBaseUrl(options.url)}/api/v1/projects/${options.slug}/builds`,
    form,
    { authorization: `Bearer ${options.token}` },
    (loaded, total) => {
      const pct = ((loaded / total) * 100).toFixed(1);
      process.stdout.write(`\r${spinnerFrames[Date.now() % 10]} Uploading ${formatBytes(loaded)} / ${formatBytes(total)} (${pct}%)`);
    }
  );

  spinner.stop("Upload complete");
  const build = await response.json();
  printLine(`Build created: ${build.id}`);
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/u, "");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}