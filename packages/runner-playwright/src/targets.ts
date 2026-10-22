/** The runner's `browsers` option: what an operator lists, and the local targets it flattens to. */
import { isBrowserName, type BrowserName } from "@storyshelf/core/adapter/capture-runner";

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
 * One entry of `browsers`: a bare engine name, or {@link local}. Remote presets join this union
 * with the remote targets (ADR 0007).
 */
export type BrowserEntry = BrowserName | LocalBrowser;

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

/**
 * Flatten the `browsers` list into local targets, first = default. Throws on an empty list, an
 * unknown engine, or two entries producing one target, naming both, so a mistake fails when the
 * runner is created and not when the first build runs.
 */
export function flattenBrowsers(entries: readonly BrowserEntry[]): LocalTarget[] {
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
    return { target: engine, channel: channelOf(engine, options) };
  });
}

/** Bare `chrome` means Chrome, not the bundled Chromium (ADR 0007, decision 7). */
function channelOf(engine: BrowserName, options: LocalOptions): string | undefined {
  return options.channel ?? (engine === "chrome" ? "chrome" : undefined);
}
