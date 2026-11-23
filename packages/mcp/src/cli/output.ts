/** Print a line to stdout. */
export function printLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** Print a line to stderr (errors, warnings, and anything on the protocol channel's side). */
export function printError(message: string): void {
  process.stderr.write(`${message}\n`);
}
