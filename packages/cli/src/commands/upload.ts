import AdmZip from "adm-zip";
import { normalizeBaseUrl, postFormWithProgress } from "../client.ts";
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

export async function runUpload(options: UploadOptions): Promise<void> {
  const base = normalizeBaseUrl(options.url);
  const storybookDir = options.storybookDir ?? "storybook-static";

  const zip = new AdmZip();
  zip.addLocalFolder(storybookDir);
  const zipBuffer = zip.toBuffer();

  const form = new FormData();
  form.set("gitSha", options.sha);
  form.set("gitBranch", options.branch);
  if (options.message) form.set("message", options.message);
  if (options.authorEmail) form.set("authorEmail", options.authorEmail);
  if (options.authorName) form.set("authorName", options.authorName);
  form.set("zip", new Blob([new Uint8Array(zipBuffer)], { type: "application/zip" }), "storybook.zip");

  const spinner = createSpinner("Uploading...");
  try {
    const build = await postFormWithProgress<{ id: string }>(
      `${base}/api/v1/projects/${options.slug}/builds`,
      form,
      { authorization: `Bearer ${options.token}` },
      (loaded, total) => {
        const pct = ((loaded / total) * 100).toFixed(1);
        process.stdout.write(`\r${spinnerFrames[Date.now() % spinnerFrames.length]} Uploading ${pct}%`);
      },
    );
    spinner.stop("Upload complete");
    printLine(`Build created: ${build.id}`);
  } catch (error) {
    spinner.stop("Upload failed");
    throw error;
  }
}
