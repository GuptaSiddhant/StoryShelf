/** Where a command writes: injected so tests read the lines and the exit code. */
export interface Io {
  out(line: string): void;
  err(line: string): void;
}

/** The process's own streams. */
export const processIo: Io = {
  out: (line) => {
    process.stdout.write(`${line}\n`);
  },
  err: (line) => {
    process.stderr.write(`${line}\n`);
  },
};
