import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";

async function readDotEnv(dir: string): Promise<string | null> {
  try {
    return await readFile(join(dir, ".env"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Add the variables of `<dir>/.env` that `env` does not set: the shell's variables win. No `.env`
 * is fine. Returns the names it added (never their values).
 */
export async function loadDotEnv(
  dir: string,
  env: Record<string, string | undefined>,
): Promise<string[]> {
  const text = await readDotEnv(dir);
  const missing = Object.entries(text === null ? {} : parseEnv(text)).filter(
    ([name, value]) => env[name] === undefined && value !== undefined,
  );
  for (const [name, value] of missing) env[name] = value;
  return missing.map(([name]) => name);
}
