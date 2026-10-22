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
  /** Playwright channel (`chrome`, `chrome-beta`, `msedge`, …); only for `chromium` and `chrome`. */
  channel?: string;
}

/** A local engine with options (ADR 0007, decision 1). */
export interface LocalBrowser {
  readonly kind: "local";
  readonly engine: BrowserName;
  readonly options: LocalOptions;
}

/**
 * One entry of `browsers`: a bare engine name, {@link local}, or a remote service from
 * `@storyshelf/runner-playwright/remote` (`playwrightServer(...)`, `remote(...)`, ...), which
 * stands for one target per engine.
 */
export type BrowserEntry = BrowserName | LocalBrowser | RemoteBrowser;

/** A local engine this runner launches. */
export interface LocalTarget {
  /** The engine name, which is also the target. */
  target: BrowserName;
  /** The Playwright channel to launch with, when one applies. */
  channel: string | undefined;
}

/** A local engine with options, for `browsers`: `local("chrome", { channel: "chrome-beta" })`. */
export function local(engine: BrowserName, options: LocalOptions = {}): LocalBrowser {
  if (!isBrowserName(engine)) {
    throw new Error(`local(): unknown engine "${String(engine)}"`);
  }
  if (options.channel !== undefined && engine !== "chromium" && engine !== "chrome") {
    throw new Error(`local("${engine}"): a channel applies only to chromium and chrome`);
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
 * Flatten the `browsers` list into targets, first = default. Throws on an empty list, an unknown
 * engine, or two entries producing one target, naming both, so a mistake fails when the runner is
 * created and not when the first build runs.
 */
export function flattenBrowsers(entries: readonly BrowserEntry[]): FlatTargets {
  if (entries.length === 0) {
    throw new Error("browsers must list at least one target");
  }
  const seen = new Map<string, number>();
  const flat: FlatTargets = { declared: [], locals: [], remotes: [] };
  for (const [index, entry] of entries.entries()) {
    for (const target of isRemoteBrowser(entry) ? remoteTargetsOf(entry) : [localOf(entry)]) {
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

function localOf(entry: BrowserName | LocalBrowser): LocalTarget {
  const { engine, options } = typeof entry === "string" ? local(entry) : entry;
  return { target: engine, channel: channelOf(engine, options) };
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

/** Bare `chrome` means Chrome, not the bundled Chromium (ADR 0007, decision 7). */
function channelOf(engine: BrowserName, options: LocalOptions): string | undefined {
  return options.channel ?? (engine === "chrome" ? "chrome" : undefined);
}
