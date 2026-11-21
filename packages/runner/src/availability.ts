/** Telling which declared local engines are installed, without launching anything (ADR 0007, decision 7). */
import type { BrowserName, RunnerTarget } from "@storyshelf/core/adapter/capture-runner";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { LocalTarget } from "./targets.ts";

/** The part of Playwright's browser types this check reads. */
export interface BrowserTypes {
  chromium: { executablePath(): string };
  firefox: { executablePath(): string };
  webkit: { executablePath(): string };
}

/** Injectable file check, so tests need no browsers installed. */
type Exists = (path: string) => boolean;

/**
 * Each local target as a {@link RunnerTarget}: `ready`, or `unavailable` with why. Playwright's
 * `executablePath()` is where the engine would be installed; installing writes an
 * `INSTALLATION_COMPLETE` marker next to it, which also covers Chromium's headless shell, the
 * binary headless launches use and whose path Playwright does not expose.
 */
export function verifyLocalTargets(
  targets: readonly LocalTarget[],
  types: BrowserTypes,
  exists: Exists = existsSync,
): RunnerTarget[] {
  return targets.map((entry) => ({
    target: entry.target,
    reach: "loopback",
    status: statusOf(entry, types, exists),
  }));
}

function statusOf(entry: LocalTarget, types: BrowserTypes, exists: Exists): RunnerTarget["status"] {
  if (entry.channel !== undefined && entry.channel !== "chromium") {
    return channelStatus(entry.channel, exists);
  }
  const engine = entry.target === "chrome" ? "chromium" : entry.target;
  const installed = installedPaths(engine, types[engine].executablePath());
  return installed.some((path) => exists(path))
    ? "ready"
    : {
        unavailable: `declared, not installed (run \`playwright install ${engine}\`, pinned to this playwright-core)`,
      };
}

/** Where `executablePath` and the install markers of `engine` live. */
function installedPaths(engine: BrowserName, executable: string): string[] {
  const installDir = revisionDir(executable);
  if (installDir === null) {
    return [executable];
  }
  const paths = [executable, join(installDir, "INSTALLATION_COMPLETE")];
  if (engine === "chromium") {
    const shell = join(
      dirname(installDir),
      basename(installDir).replace(/^chromium-/u, "chromium_headless_shell-"),
    );
    paths.push(join(shell, "INSTALLATION_COMPLETE"));
  }
  return paths;
}

/** The `<engine>-<revision>` directory an executable sits in (its depth differs per engine). */
function revisionDir(executable: string): string | null {
  for (let dir = dirname(executable); dirname(dir) !== dir; dir = dirname(dir)) {
    if (/^(?:chromium|firefox|webkit)-\d+$/u.test(basename(dir))) {
      return dir;
    }
  }
  return null;
}

/** Browsers a channel installs (system Chrome and Edge) are checked where Playwright looks for them. */
function channelStatus(channel: string, exists: Exists): RunnerTarget["status"] {
  const known = channelPaths(channel);
  if (known === null || known.some((path) => exists(path))) {
    return "ready";
  }
  return {
    unavailable: `channel "${channel}" is not installed (run \`playwright install ${channel}\`)`,
  };
}

/** Install locations per platform; `null` for a channel this check cannot place (a launch will tell). */
function channelPaths(channel: string): string[] | null {
  if (channel !== "chrome") {
    return null;
  }
  if (process.platform === "linux") {
    return ["/opt/google/chrome/chrome"];
  }
  if (process.platform === "darwin") {
    return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }
  if (process.platform === "win32") {
    return ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"].flatMap((name) => {
      const root = process.env[name];
      return root ? [join(root, "Google", "Chrome", "Application", "chrome.exe")] : [];
    });
  }
  return null;
}
