/** Print a line to stdout. */
export function printLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** Print a line to stderr (errors and warnings). */
export function printError(message: string): void {
  process.stderr.write(`${message}\n`);
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

/** True when progress may redraw lines: stderr is a terminal and `CI` is not set. */
export function isInteractive(
  env: NodeJS.ProcessEnv = process.env,
  isTTY = process.stderr.isTTY,
): boolean {
  return isTTY ? !env["CI"] : false;
}

/** Phase reporting: `==> Writing` then `--> Wrote (0.4s)`. */
export interface Reporter {
  /** Run `body` as a phase; the error of a failing body is rethrown unchanged. */
  phase<T>(open: string, done: string, body: () => Promise<T>): Promise<T>;
}

/** Where and how a {@link Reporter} writes (tests inject all three). */
export interface ReporterOptions {
  write?: (text: string) => void;
  now?: () => number;
  interactive?: boolean;
}

/** Create a {@link Reporter} that writes to stderr, so stdout stays for results. */
export function createReporter(options: ReporterOptions = {}): Reporter {
  const write =
    options.write ??
    ((text: string): void => {
      process.stderr.write(text);
    });
  const now = options.now ?? ((): number => performance.now());
  const clear = (options.interactive ?? isInteractive()) ? "\r\u001B[2K" : "";
  return {
    async phase(open, done, body) {
      const started = now();
      write(`==> ${open}\n`);
      const took = (): string => `(${formatDuration(now() - started)})`;
      try {
        const result = await body();
        write(`${clear}--> ${done} ${took()}\n`);
        return result;
      } catch (error) {
        write(`${clear}--> Failed: ${open} ${took()}\n`);
        throw error;
      }
    },
  };
}
