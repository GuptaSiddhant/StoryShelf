/** The runner's `browsers` option: what an operator lists, and the local targets it flattens to. */
import { isBrowserName, type BrowserName } from "@storyshelf/core/adapter/capture-runner";

/** Options of {@link local}. */
export interface LocalOptions {
  /** The browser binary this target launches (`puppeteer-core` ships none). */
  executablePath?: string;
}

/** A local engine with options (ADR 0007, decision 1). */
export interface LocalBrowser {
  readonly kind: "local";
  readonly engine: BrowserName;
  readonly options: LocalOptions;
}

/**
 * One entry of `browsers`: a bare engine name, or {@link local}. Remote CDP presets join this union
 * with the remote targets (ADR 0007).
 */
export type BrowserEntry = BrowserName | LocalBrowser;

/** A local engine this runner launches. */
export interface LocalTarget {
  /** The engine name, which is also the target. */
  target: BrowserName;
  /** The binary to launch: the entry's own, else the runner's for `chromium`; none for bare `chrome`. */
  executablePath: string | undefined;
}

/** Engines Puppeteer drives: the Chromium family. */
const SUPPORTED: readonly BrowserName[] = ["chromium", "chrome"];

/** A local engine with options, for `browsers`: `local("chrome", { executablePath: "/usr/bin/google-chrome" })`. */
export function local(engine: BrowserName, options: LocalOptions = {}): LocalBrowser {
  if (!isBrowserName(engine)) {
    throw new Error(`local(): unknown engine "${String(engine)}"`);
  }
  if (!SUPPORTED.includes(engine)) {
    throw new Error(
      `local("${engine}"): the Puppeteer runner drives Chromium-family engines only (${SUPPORTED.join(", ")})`,
    );
  }
  return { kind: "local", engine, options };
}

/**
 * Flatten the `browsers` list into local targets, first = default. Throws on an empty list, an
 * engine Puppeteer cannot drive, bare `chrome` (it needs its own `executablePath`, since the
 * runner's would launch whatever it points at under Chrome's name), or two entries producing one
 * target, so a mistake fails when the runner is created and not when the first build runs.
 */
export function flattenBrowsers(
  entries: readonly BrowserEntry[],
  runnerExecutablePath?: string,
): LocalTarget[] {
  if (entries.length === 0) {
    throw new Error("browsers must list at least one target");
  }
  const seen = new Map<BrowserName, number>();
  return entries.map((entry, index) => {
    const { engine, options } = typeof entry === "string" ? local(entry) : entry;
    const first = seen.get(engine);
    if (first !== undefined) {
      throw new Error(
        `browsers entries ${first + 1} and ${index + 1} both produce the target "${engine}"`,
      );
    }
    seen.set(engine, index);
    return { target: engine, executablePath: pathOf(engine, options, runnerExecutablePath) };
  });
}

function pathOf(
  engine: BrowserName,
  options: LocalOptions,
  runnerExecutablePath?: string,
): string | undefined {
  if (options.executablePath !== undefined) {
    return options.executablePath;
  }
  if (engine === "chrome") {
    throw new Error(
      `"chrome" needs an executablePath: use local("chrome", { executablePath: "/usr/bin/google-chrome" })`,
    );
  }
  return runnerExecutablePath;
}
