/**
 * The environment of a remote browser, measured inside it (ADR 0007, decision 2). `fc-list` and
 * `process.platform` describe the machine running the runner, not the one that rendered.
 */
import type { CaptureEnvironment } from "../adapters/capture-runner.ts";
import { sha256 } from "./hash.ts";

/** What the probe page reports. */
export interface BrowserProbe {
  /** OS as the page sees it (`navigator.userAgentData.platform`, else `navigator.platform`). */
  platform?: string;
  deviceScaleFactor?: number;
  /** Which of {@link FONT_PROBE_FAMILIES} are installed. */
  fonts?: string[];
}

/**
 * Families probed for the fonts digest: system fonts that differ between operating systems and
 * image builds, so a provider-side change moves the hash. A fixed list; changing it re-baselines
 * every remote target's fingerprint.
 */
export const FONT_PROBE_FAMILIES: readonly string[] = [
  "Arial",
  "Helvetica",
  "Helvetica Neue",
  "Times New Roman",
  "Georgia",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Courier New",
  "Consolas",
  "Menlo",
  "Monaco",
  "Segoe UI",
  "Calibri",
  "Cambria",
  "San Francisco",
  "SF Pro Text",
  "Lucida Grande",
  "Roboto",
  "Open Sans",
  "Noto Sans",
  "Noto Serif",
  "Noto Sans Mono",
  "Noto Color Emoji",
  "Apple Color Emoji",
  "Segoe UI Emoji",
  "DejaVu Sans",
  "DejaVu Serif",
  "DejaVu Sans Mono",
  "Liberation Sans",
  "Liberation Serif",
  "Liberation Mono",
  "Ubuntu",
  "Cantarell",
  "Droid Sans",
  "Source Sans Pro",
  "Fira Sans",
  "Inter",
  "Arial Unicode MS",
  "MS Gothic",
  "Hiragino Sans",
  "PingFang SC",
  "Microsoft YaHei",
  "Malgun Gothic",
];

/**
 * Read the OS, the device pixel ratio and the installed probe fonts. Runs inside the page, so it
 * must stay one self-contained function (no imports, no closures): the runners pass it to
 * `page.evaluate`, which sends its source. A font counts as installed when text in it measures
 * differently from the generic family it would fall back to; `document.fonts.check` answers `true`
 * for a family that does not exist, so it cannot tell.
 */
// oxlint-disable-next-line eslint/max-statements, eslint/max-lines-per-function -- must stay one self-contained function (see above)
export function inPageProbe(families: string[]): BrowserProbe {
  const win = globalThis as unknown as {
    devicePixelRatio?: number;
    navigator: { userAgentData?: { platform?: string }; platform?: string };
    document: {
      createElement: (tag: string) => {
        getContext: (kind: string) => {
          font: string;
          measureText: (text: string) => { width: number };
        } | null;
      };
    };
  };
  const probe: BrowserProbe = {};
  const reported = win.navigator.userAgentData?.platform;
  const platform = reported === undefined || reported === "" ? win.navigator.platform : reported;
  if (platform) probe.platform = platform;
  if (typeof win.devicePixelRatio === "number") probe.deviceScaleFactor = win.devicePixelRatio;
  const context = win.document.createElement("canvas").getContext("2d");
  if (!context) return probe;
  const text = "mmmmmmmmmmlli1WwQqÅgy 漢字";
  const generics = ["monospace", "sans-serif", "serif"];
  const widthOf = (font: string): number => {
    context.font = `72px ${font}`;
    return context.measureText(text).width;
  };
  const baseline = generics.map((generic) => widthOf(generic));
  probe.fonts = families.filter((family) =>
    generics.some((generic, index) => widthOf(`"${family}", ${generic}`) !== baseline[index]),
  );
  return probe;
}

/** How a {@link boundedProbe} ended. */
export type ProbeOutcome<T> =
  | { status: "done"; value: T }
  /** Still running after `timeoutMs`: the environment is unknown, the run goes on. */
  | { status: "timeout" }
  /** The run was cancelled: the run stops, it is never read as "unknown environment". */
  | { status: "cancelled" }
  /** The probe threw (a service outage, a page that would not open): unknown, with a warning. */
  | { status: "failed"; error: unknown };

/** What a probe's work can ask about its own fate. */
export interface ProbeControl {
  /**
   * True once the probe timed out or was cancelled. Work that opens a page must check it after
   * every await and release what it opened, because nothing waits for it any more.
   */
  stopped: () => boolean;
}

/**
 * Run probe work under a time limit and a cancel signal (ADR 0007, decision 2). A probe that hangs
 * on an unresponsive service must not hold a render, and a cancel must interrupt it instead of
 * waiting for the service. The work is never awaited past the limit and never leaves an unhandled
 * rejection; releasing the page it opened is the caller's job (`ProbeControl.stopped`, or closing
 * what it holds once this returns). A failure after the signal fired reads as cancelled, since
 * closing the browser is how a cancel interrupts it.
 */
export async function boundedProbe<T>(options: {
  run: (control: ProbeControl) => Promise<T>;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}): Promise<ProbeOutcome<T>> {
  const { signal, timeoutMs } = options;
  if (signal?.aborted) {
    return { status: "cancelled" };
  }
  const halt = { halted: false };
  const work = options.run({ stopped: () => halt.halted }).then(
    (value): ProbeOutcome<T> => ({ status: "done", value }),
    (error: unknown): ProbeOutcome<T> => ({ status: "failed", error }),
  );
  return await settle(work, limitOf<T>(timeoutMs, signal), signal, halt);
}

/** Wait for the work or the limit, mark the work stopped if it lost, and drop the timer and listener. */
async function settle<T>(
  work: Promise<ProbeOutcome<T>>,
  limit: { reached: Promise<ProbeOutcome<T>>; clear: () => void },
  signal: AbortSignal | undefined,
  halt: { halted: boolean },
): Promise<ProbeOutcome<T>> {
  try {
    const outcome = await Promise.race([work, limit.reached]);
    halt.halted = outcome.status === "timeout" || outcome.status === "cancelled";
    return outcome.status === "failed" && signal?.aborted ? { status: "cancelled" } : outcome;
  } finally {
    limit.clear();
  }
}

/** A promise that settles on the timeout or the abort, and a way to drop both. */
function limitOf<T>(
  timeoutMs: number,
  signal: AbortSignal | undefined,
): { reached: Promise<ProbeOutcome<T>>; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const reached = new Promise<ProbeOutcome<T>>((resolve) => {
    timer = setTimeout(() => {
      resolve({ status: "timeout" });
    }, timeoutMs);
    onAbort = (): void => {
      resolve({ status: "cancelled" });
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  return {
    reached,
    clear: (): void => {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * The environment of a remote render: the driver's browser version and what the page reported. A
 * field the page could not give is left out, except the OS, which falls back to what the service
 * was configured to render on; an unknown fingerprint component is never a change (ADR 0005).
 */
export function remoteEnvironment(options: {
  browserVersion?: string | undefined;
  probe?: BrowserProbe | undefined;
  declaredPlatform?: string | undefined;
}): CaptureEnvironment {
  const { probe, browserVersion } = options;
  const platform = normalizePlatform(probe?.platform) ?? options.declaredPlatform;
  const fonts = probe?.fonts;
  return {
    ...(browserVersion ? { browserVersion } : {}),
    ...(platform ? { platform } : {}),
    ...(probe?.deviceScaleFactor ? { deviceScaleFactor: probe.deviceScaleFactor } : {}),
    ...(fonts && fonts.length > 0
      ? { fontsHash: sha256(fonts.toSorted().join("\n")).slice(0, 16) }
      : {}),
  };
}

/** `Win32`, `Windows` and `Linux x86_64` read as the OS, in one spelling per OS. */
function normalizePlatform(value: string | undefined): string | undefined {
  const text = value?.trim().toLowerCase();
  if (!text) {
    return undefined;
  }
  if (text.startsWith("win")) return "windows";
  if (text.startsWith("mac") || text === "iphone" || text === "ipad") return "macos";
  return text.startsWith("linux") ? "linux" : text;
}
