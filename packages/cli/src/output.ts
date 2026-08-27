export function printLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function printError(message: string): void {
  process.stderr.write(`${message}\n`);
}
