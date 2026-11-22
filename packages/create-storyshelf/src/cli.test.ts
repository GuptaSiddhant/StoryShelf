import { afterEach, describe, expect, it, vi } from "vitest";
import { main, parseArguments } from "./cli.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseArguments", () => {
  it("takes a positional directory, the same as --dir", () => {
    expect(parseArguments(["my-server"])).toEqual({
      kind: "run",
      dir: "my-server",
      install: false,
    });
    expect(parseArguments(["--dir", "d"])).toEqual({ kind: "run", dir: "d", install: false });
    expect(parseArguments([])).toEqual({ kind: "run", install: false });
  });

  it("takes --cloud and --install", () => {
    expect(parseArguments(["--cloud", "aws", "--install"])).toEqual({
      kind: "run",
      cloud: "aws",
      install: true,
    });
  });

  it("answers help and the version before anything else", () => {
    expect(parseArguments(["--help"])).toEqual({ kind: "help" });
    expect(parseArguments(["-h"])).toEqual({ kind: "help" });
    expect(parseArguments(["-v"])).toEqual({ kind: "version" });
  });

  it("refuses an unknown flag and a second directory", () => {
    expect(parseArguments(["--nope"])).toMatchObject({ kind: "error" });
    expect(parseArguments(["a", "b"])).toEqual({
      kind: "error",
      message: 'unexpected argument "b"',
    });
  });
});

function capture(): { out: () => string; err: () => string } {
  let out = "";
  let err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    err += String(chunk);
    return true;
  });
  return { out: () => out, err: () => err };
}

describe("main", () => {
  it("prints the help and the version, exit 0", async () => {
    const io = capture();
    expect(await main(["--help"])).toBe(0);
    expect(io.out()).toContain("npm create storyshelf");
    expect(await main(["--version"])).toBe(0);
  });

  it("explains an argument error, exit 2, writing nothing", async () => {
    const io = capture();
    expect(await main(["--nope"])).toBe(2);
    expect(io.err()).toContain('Run "create-storyshelf --help"');
  });

  it("reports an unknown cloud, exit 1", async () => {
    const io = capture();
    expect(await main(["--cloud", "fly"])).toBe(1);
    expect(io.err()).toContain('Unknown --cloud "fly"');
  });
});
