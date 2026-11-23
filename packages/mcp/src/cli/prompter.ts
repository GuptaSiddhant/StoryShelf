import { createInterface } from "node:readline/promises";

/** One choice of a {@link Prompter.select} question. */
export interface Choice<T extends string> {
  title: string;
  value: T;
}

/**
 * The few questions `init` asks. `null` means the person cancelled (Ctrl-C, or input ended).
 * Tests pass their own; {@link readlinePrompter} is the terminal one, with no dependency.
 */
export interface Prompter {
  text(message: string, initial: string): Promise<string | null>;
  select<T extends string>(message: string, choices: readonly Choice<T>[]): Promise<T | null>;
  confirm(message: string, initial: boolean): Promise<boolean | null>;
  close(): void;
}

/** Ask on stderr (stdout stays free for protocol output) and read lines from stdin. */
export function readlinePrompter(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stderr,
): Prompter {
  const rl = createInterface({ input, output });
  // Input that ends mid-question (no terminal, `< /dev/null`) closes the interface and would leave
  // the question pending forever: it answers null, a cancel, instead.
  const closed = new Promise<null>((done) => {
    rl.once("close", () => {
      done(null);
    });
  });
  const ask = async (question: string): Promise<string | null> => {
    try {
      return await Promise.race([rl.question(question), closed]);
    } catch {
      return null;
    }
  };
  return {
    async text(message, initial) {
      const answer = await ask(`${message} (${initial}) `);
      return answer === null ? null : answer.trim() || initial;
    },
    async select(message, choices) {
      const list = choices.map((choice, index) => `  ${index + 1}. ${choice.title}`).join("\n");
      const answer = await ask(`${message}\n${list}\nChoose 1-${choices.length} (1) `);
      if (answer === null) return null;
      const picked = choices[(Number(answer.trim()) || 1) - 1];
      return (picked ?? choices[0])?.value ?? null;
    },
    async confirm(message, initial) {
      const answer = await ask(`${message} (${initial ? "Y/n" : "y/N"}) `);
      if (answer === null) return null;
      const text = answer.trim().toLowerCase();
      return text === "" ? initial : text.startsWith("y");
    },
    close: () => {
      rl.close();
    },
  };
}
