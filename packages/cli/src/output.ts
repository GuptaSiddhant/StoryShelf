/** Print a line to stdout with a trailing newline. */
export function printLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** Print a line to stderr (used for errors and warnings). */
export function printError(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** Braille spinner frames used by {@link createSpinner} for upload progress. */
export const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Create an inline spinner that animates while a long operation runs.
 *
 * @param message - Message shown next to the spinning frame
 * @param frames - Frame sequence; defaults to {@link spinnerFrames}
 * @returns Handle with `stop(finalMessage?)` to clear the line and optionally print a result
 */
export function createSpinner(
  message: string,
  frames: readonly string[] = spinnerFrames,
): { stop(finalMessage?: string): void } {
  let frame = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r${frames[frame % frames.length]} ${message}`);
    frame += 1;
  }, 80);
  return {
    stop: (finalMessage?: string): void => {
      clearInterval(interval);
      if (finalMessage) {
        process.stdout.write(`\r${finalMessage}\n`);
      } else {
        process.stdout.write("\r");
      }
    },
  };
}

/** Format a duration for a phase line: `0.4s`, `12.3s`, `1m 05s`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
}

/** Format a byte count with binary units: `512 B`, `18.3 MiB`. */
export function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

/** Progress text for a byte stream: `42% of 18.3 MiB`. */
export function describeByteProgress(done: number, total: number): string {
  const percent = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0;
  return `${percent}% of ${formatBytes(total)}`;
}

/** The progress text for a count of files: `120/860 files`. */
export function describeFileProgress(done: number, total: number): string {
  return `${done}/${total} files`;
}

/** Handle given to a phase body to report live progress. */
export interface PhaseHandle {
  /** Show transient progress text. Redrawn in place on a terminal, dropped in logs. */
  progress(text: string): void;
}

/** Where and how a {@link Reporter} writes. */
export interface ReporterOptions {
  /** Write progress and phase lines (stderr by default, so stdout stays for results). */
  write?: (text: string) => void;
  /** Monotonic millisecond clock; tests inject a fake. */
  now?: () => number;
  /** Redraw lines in place. Defaults to {@link isInteractive}. */
  interactive?: boolean;
  /** Use ANSI bold. Defaults to interactive and `NO_COLOR` unset. */
  color?: boolean;
}

/** Phase reporting for long commands: `==> Opening` then `--> Opened (0.4s)`. */
export interface Reporter {
  /**
   * Run `body` as a phase. Prints `==> <open>` first and `--> <done> (<time>)` after, or
   * `--> Failed: <open> (<time>)` when it throws (the error is rethrown unchanged).
   */
  phase<T>(open: string, done: string, body: (handle: PhaseHandle) => Promise<T>): Promise<T>;
  /** Time since the reporter was created, formatted like a phase time. */
  elapsed(): string;
}

/** True when progress may redraw lines: stderr is a terminal and `CI` is not set. */
export function isInteractive(
  env: NodeJS.ProcessEnv = process.env,
  isTTY = process.stderr.isTTY,
): boolean {
  return isTTY ? !env["CI"] : false;
}

/** Create a {@link Reporter}. Nothing it writes ever contains a token or a signed URL: callers pass titles only. */
export function createReporter(options: ReporterOptions = {}): Reporter {
  const write =
    options.write ??
    ((text: string): void => {
      process.stderr.write(text);
    });
  const now = options.now ?? ((): number => performance.now());
  const interactive = options.interactive ?? isInteractive();
  const color = options.color ?? (interactive && !process.env["NO_COLOR"]);
  const bold = (text: string): string => (color ? `\u001B[1m${text}\u001B[22m` : text);
  const created = now();
  const clear = interactive ? "\r\u001B[2K" : "";
  return {
    elapsed: () => formatDuration(now() - created),
    async phase(open, done, body) {
      const started = now();
      write(`${bold(`==> ${open}`)}\n`);
      const handle: PhaseHandle = {
        progress: (text) => {
          if (interactive) write(`\r\u001B[2K    ${text}`);
        },
      };
      const took = (): string => `(${formatDuration(now() - started)})`;
      try {
        const result = await body(handle);
        write(`${clear}--> ${done} ${took()}\n`);
        return result;
      } catch (error) {
        write(`${clear}--> Failed: ${open} ${took()}\n`);
        throw error;
      }
    },
  };
}
