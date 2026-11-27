import { describe, expect, it } from "vitest";
import { parseServerArgs } from "./args.ts";

describe("parseServerArgs", () => {
  it("shows help with no command, with --help and with `help`", () => {
    expect(parseServerArgs([])).toEqual({ kind: "help" });
    expect(parseServerArgs(["serve", "--help"])).toEqual({ kind: "help" });
    expect(parseServerArgs(["help"])).toEqual({ kind: "help" });
  });

  it("shows the version", () => {
    expect(parseServerArgs(["--version"])).toEqual({ kind: "version" });
  });

  it("parses a command with its flags", () => {
    expect(parseServerArgs(["serve", "--dir", "x", "--port", "8080"])).toEqual({
      kind: "run",
      command: "serve",
      flags: { dir: "x", port: 8080 },
    });
    expect(parseServerArgs(["purge", "--ttl-days", "7"])).toMatchObject({ flags: { ttlDays: 7 } });
    expect(parseServerArgs(["check-storage", "--sample", "3"])).toMatchObject({
      flags: { sample: 3 },
    });
  });

  it("reports unknown commands, flags, extra arguments and bad numbers", () => {
    expect(parseServerArgs(["nope"])).toMatchObject({ kind: "error" });
    expect(parseServerArgs(["serve", "--nope"])).toMatchObject({ kind: "error" });
    expect(parseServerArgs(["serve", "extra"])).toMatchObject({ kind: "error" });
    expect(parseServerArgs(["serve", "--port", "abc"])).toMatchObject({ kind: "error" });
    expect(parseServerArgs(["serve", "--port", "0"])).toMatchObject({ kind: "error" });
  });
});

describe("parseServerArgs: entry and watch", () => {
  it("takes --entry and --watch", () => {
    expect(parseServerArgs(["serve", "--entry", "app/server.ts", "--watch"])).toEqual({
      kind: "run",
      command: "serve",
      flags: { entry: "app/server.ts", watch: true },
    });
    expect(parseServerArgs(["doctor", "--entry", "x.ts"])).toMatchObject({
      flags: { entry: "x.ts" },
    });
  });

  it("refuses --watch on any command but serve", () => {
    expect(parseServerArgs(["migrate", "--watch"])).toMatchObject({ kind: "error" });
  });
});

describe("parseServerArgs: invite", () => {
  it("takes the email, --name and --role", () => {
    expect(
      parseServerArgs(["invite", "ana@example.com", "--name", "Ana", "--role", "admin"]),
    ).toEqual({
      kind: "run",
      command: "invite",
      flags: { email: "ana@example.com", name: "Ana", role: "admin" },
    });
  });

  it("needs exactly one email, and keeps --name and --role to invite", () => {
    expect(parseServerArgs(["invite"])).toMatchObject({ kind: "error" });
    expect(parseServerArgs(["invite", "a@b.co", "c@d.co"])).toMatchObject({ kind: "error" });
    expect(parseServerArgs(["purge", "--name", "x"])).toMatchObject({ kind: "error" });
  });
});
