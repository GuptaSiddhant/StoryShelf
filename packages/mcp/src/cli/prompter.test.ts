import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { readlinePrompter } from "./prompter.ts";

function terminal(lines: string[]): ReturnType<typeof readlinePrompter> {
  const input = new PassThrough();
  const output = new PassThrough();
  const ask = readlinePrompter(input, output);
  // Answers arrive as the questions are asked, as at a terminal.
  output.on("data", () => {
    const next = lines.shift();
    if (next !== undefined) input.write(`${next}\n`);
  });
  return ask;
}

describe("readlinePrompter", () => {
  it("takes the typed text, or the default for an empty line", async () => {
    const ask = terminal(["typed", ""]);
    expect(await ask.text("Name?", "dflt")).toBe("typed");
    expect(await ask.text("Dir?", "./dflt")).toBe("./dflt");
    ask.close();
  });

  it("selects by number, defaulting to the first choice", async () => {
    const ask = terminal(["2", "", "9"]);
    const choices = [
      { title: "A", value: "a" },
      { title: "B", value: "b" },
    ] as const;
    expect(await ask.select("Pick", choices)).toBe("b");
    expect(await ask.select("Pick", choices)).toBe("a");
    expect(await ask.select("Pick", choices)).toBe("a");
    ask.close();
  });

  it("confirms with y or n, defaulting to the stated answer", async () => {
    const ask = terminal(["y", "n", "", ""]);
    expect(await ask.confirm("Sure?", false)).toBe(true);
    expect(await ask.confirm("Sure?", true)).toBe(false);
    expect(await ask.confirm("Sure?", true)).toBe(true);
    expect(await ask.confirm("Sure?", false)).toBe(false);
    ask.close();
  });

  it("answers undefined once the input has ended", async () => {
    const input = new PassThrough();
    const ask = readlinePrompter(input, new PassThrough());
    input.end();
    expect(await ask.text("Name?", "x")).toBeNull();
    expect(await ask.confirm("Sure?", true)).toBeNull();
    expect(await ask.select("Pick", [{ title: "A", value: "a" }])).toBeNull();
  });
});
