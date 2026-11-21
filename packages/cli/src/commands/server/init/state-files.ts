/**
 * The local Terraform files `server init --cloud` protects: `apply` writes state and plans beside the
 * stub, and both hold the generated secrets, so the stub ignores them and says where state belongs.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

/** Write the state ignores, or add the missing ones to a `.gitignore` that already exists. */
export async function writeStateGitignore(path: string): Promise<void> {
  const current = existsSync(path) ? await readFile(path, "utf8") : "";
  const lines = new Set(current.split(/\r?\n/u).map((line) => line.trim()));
  const missing = STATE_GITIGNORE.filter((entry) => !lines.has(entry));
  if (missing.length === 0) {
    return;
  }
  const prefix = current === "" || current.endsWith("\n") ? current : `${current}\n`;
  await writeFile(path, `${prefix}${missing.join("\n")}\n`);
}

/** What `apply` writes beside the stub and must never be committed: state and plans hold secrets. */
export const STATE_GITIGNORE = ["*.tfstate*", ".terraform/", "tfplan"] as const;

/** Printed after the stub is written: the local state is a secret, not a build artifact. */
export const STATE_WARNING =
  "The Terraform state holds the generated secrets (SHELF_SECRET, SHELF_ADMIN_TOKEN, passwords): keep it in an encrypted remote backend, never in git.";
