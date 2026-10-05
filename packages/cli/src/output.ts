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
