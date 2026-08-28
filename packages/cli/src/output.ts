export function printLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function printError(message: string): void {
  process.stderr.write(`${message}\n`);
}

export const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function createSpinner(message: string, frames: readonly string[] = spinnerFrames): { stop(finalMessage?: string): void } {
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
