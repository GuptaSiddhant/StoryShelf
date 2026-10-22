/** The runner's `browsers` option: what an operator lists, and the local targets it flattens to. */
import {
  isBrowserName,
  isRemoteBrowser,
  remoteTargetsOf,
  type BrowserName,
  type RemoteBrowser,
  type RemoteTarget,
  type RunnerTarget,
} from "@storyshelf/core/adapter/capture-runner";

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
 * One entry of `browsers`: a bare engine name, {@link local}, or a remote CDP service from
 * `@storyshelf/runner-puppeteer/remote` (`cdp(...)`), which stands for one target per engine.
 */
export type BrowserEntry = BrowserName | LocalBrowser | RemoteBrowser;

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

/** The `browsers` list, flattened: what the runner offers and how to start each target. */
export interface FlatTargets {
  /** Every target as the runner declares it, default first (all `ready` until verified). */
  declared: RunnerTarget[];
  locals: LocalTarget[];
  remotes: RemoteTarget[];
}

/**
 * Flatten the `browsers` list into targets, first = default. Throws on an empty list, an engine
 * Puppeteer cannot drive, bare `chrome` (it needs its own `executablePath`, since the runner's
 * would launch whatever it points at under Chrome's name), or two entries producing one target,
 * so a mistake fails when the runner is created and not when the first build runs.
 */
export function flattenBrowsers(
  entries: readonly BrowserEntry[],
  runnerExecutablePath?: string,
): FlatTargets {
  if (entries.length === 0) {
    throw new Error("browsers must list at least one target");
  }
  const seen = new Map<string, number>();
  const flat: FlatTargets = { declared: [], locals: [], remotes: [] };
  for (const [index, entry] of entries.entries()) {
    const produced = isRemoteBrowser(entry)
      ? remoteTargetsOf(entry)
      : [localOf(entry, runnerExecutablePath)];
    for (const target of produced) {
      claim(seen, target.target, index);
      add(flat, target);
    }
  }
  return flat;
}

/** Record that entry `index` produces `target`, refusing a second entry that does. */
function claim(seen: Map<string, number>, target: string, index: number): void {
  const first = seen.get(target);
  if (first !== undefined) {
    throw new Error(
      `browsers entries ${first + 1} and ${index + 1} both produce the target "${target}"`,
    );
  }
  seen.set(target, index);
}

function localOf(entry: BrowserName | LocalBrowser, runnerExecutablePath?: string): LocalTarget {
  const { engine, options } = typeof entry === "string" ? local(entry) : entry;
  return { target: engine, executablePath: pathOf(engine, options, runnerExecutablePath) };
}

function add(flat: FlatTargets, target: LocalTarget | RemoteTarget): void {
  if ("kind" in target) {
    flat.remotes.push(target);
    flat.declared.push({ target: target.target, reach: target.reach, status: "ready" });
  } else {
    flat.locals.push(target);
    flat.declared.push({ target: target.target, reach: "loopback", status: "ready" });
  }
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
