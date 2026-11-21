import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Io } from "../io.ts";

const fixture = fileURLToPath(new URL("instance-app.ts", import.meta.url));

/** A directory whose `src/index.ts` is the given module source (default: re-export the real fixture app). */
export function instanceDir(
  source = `import { createFixtureApp } from ${JSON.stringify(fixture)};\nexport default createFixtureApp();\n`,
): string {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-instance-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/index.ts"), source);
  return dir;
}

/** An {@link Io} that records its lines. */
export function recordingIo(): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    out: (line) => {
      stdout.push(line);
    },
    err: (line) => {
      stderr.push(line);
    },
    stdout,
    stderr,
  };
}
