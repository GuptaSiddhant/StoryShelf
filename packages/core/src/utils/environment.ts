/** Detects the rendering environment a capture runner reports (see `CaptureEnvironment`). */
import type { CaptureEnvironment } from "../adapters/capture-runner.ts";
import { sha256 } from "./hash.ts";

type ChildProcessModule = typeof import("node:child_process");

let fonts: Promise<string | undefined> | undefined;

/**
 * Digest of the installed system font families (`fc-list`), or undefined where fontconfig is not
 * available. Cached for the process: fonts do not change under a running server.
 */
export async function systemFontsHash(): Promise<string | undefined> {
  fonts ??= listFonts();
  return await fonts;
}

async function listFonts(): Promise<string | undefined> {
  const getBuiltin = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  const childProcess = getBuiltin?.call(process, "node:child_process") as
    | ChildProcessModule
    | undefined;
  if (!childProcess) {
    return undefined;
  }
  return await new Promise<string | undefined>((resolve) => {
    childProcess.execFile("fc-list", [":", "family"], { timeout: 3000 }, (error, stdout) => {
      resolve(error ? undefined : digestOf(stdout));
    });
  });
}

/**
 * The environment a runner captured in: browser build, host platform, device scale factor and a
 * font digest. Runners call this once per render with the version their driver reports.
 */
export async function detectCaptureEnvironment(
  browserVersion?: string,
  deviceScaleFactor = 1,
): Promise<CaptureEnvironment> {
  const fontsHash = await systemFontsHash();
  return {
    ...(browserVersion ? { browserVersion } : {}),
    platform: `${process.platform}-${process.arch}`,
    deviceScaleFactor,
    ...(fontsHash ? { fontsHash } : {}),
  };
}

/** Digest of the distinct family names in `fc-list` output; undefined when there are none. */
function digestOf(stdout: string): string | undefined {
  const families = [...new Set(stdout.split("\n").map((line) => line.trim()))].filter(Boolean);
  return families.length > 0 ? sha256(families.toSorted().join("\n")).slice(0, 16) : undefined;
}
