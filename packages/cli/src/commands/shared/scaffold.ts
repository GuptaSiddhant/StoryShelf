import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Server entry in a scaffolded project (a `src/` dir leaves room for helper modules). */
export const SERVER_ENTRY = "src/index.ts";

/** Worker entry in a scaffolded project. */
export const WORKER_ENTRY = "src/worker.ts";

/** Dev dependencies every scaffolded project gets (editor + `tsc --noEmit`). */
export const SCAFFOLD_DEV_DEPENDENCIES: Record<string, string> = {
  "@types/node": "^24.0.0",
  typescript: "^7.0.2",
};

/** `tsconfig.json` for a scaffolded project: type-check only (Node strips types at runtime). */
export function generateTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "es2023",
        module: "nodenext",
        moduleResolution: "nodenext",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        verbatimModuleSyntax: true,
        allowImportingTsExtensions: true,
        types: ["node"],
      },
      include: ["src"],
    },
    null,
    2,
  )}\n`;
}

/** Write `contents` to `outDir/relativePath`, creating parent directories. */
export async function writeScaffoldFile(
  outDir: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  const target = join(outDir, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}
