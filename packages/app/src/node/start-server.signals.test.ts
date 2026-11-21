import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";

const CHILD = join(import.meta.dirname, "__fixtures__/signal-child.ts");

/** The `nub` binary, which runs the app's TypeScript and JSX source with the `source` condition. */
function nubBinary(): string {
  const dirs = [...(process.env["PATH"] ?? "").split(delimiter), join(homedir(), ".nub/bin")];
  const found = dirs.map((dir) => join(dir, "nub")).find((file) => existsSync(file));
  if (!found) {
    throw new Error("nub is not on PATH: the signal test runs its child with nub");
  }
  return found;
}

interface ChildRun {
  child: ChildProcess;
  /** Resolves with the next stdout line whose `event` matches. */
  next(event: string): Promise<Record<string, unknown>>;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>;
}

function startChild(): ChildRun {
  const child = spawn(nubBinary(), [CHILD], { stdio: ["ignore", "pipe", "pipe"] });
  const lines: Array<Record<string, unknown>> = [];
  const waiting = new Map<string, (line: Record<string, unknown>) => void>();
  let buffer = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const part of parts.filter((text) => text.startsWith("{"))) {
      const line = JSON.parse(part) as Record<string, unknown>;
      lines.push(line);
      waiting.get(String(line["event"]))?.(line);
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
  }>((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ code, signal, stderr });
    });
  });
  const next = async (event: string): Promise<Record<string, unknown>> =>
    lines.find((line) => line["event"] === event) ??
    (await Promise.race([
      new Promise<Record<string, unknown>>((resolve) => waiting.set(event, resolve)),
      exited.then((exit) => {
        throw new Error(`child exited (${String(exit.code)}) before "${event}":\n${exit.stderr}`);
      }),
    ]));
  return { child, next, exited };
}

describe("startServer signals (child process)", () => {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    it(`${signal} shuts down once, removes the host's handlers, and the process ends by itself`, async () => {
      const run = startChild();
      const listening = await run.next("listening");
      expect(listening["handlers"]).toEqual({
        SIGINT: (listening["before"] as Record<string, number>)["SIGINT"]! + 1,
        SIGTERM: (listening["before"] as Record<string, number>)["SIGTERM"]! + 1,
      });
      const health = await fetch(`http://127.0.0.1:${String(listening["port"])}/api/v1/health`);
      expect(health.status).toBe(200);
      // The server's own node process, not the `nub` wrapper around it.
      const pid = Number(listening["pid"]);
      process.kill(pid, signal);
      // A repeated signal during the shutdown joins it instead of starting a second teardown.
      process.kill(pid, signal);
      const closed = await run.next("closed");
      expect(closed["result"]).toMatchObject({ complete: true, trigger: signal });
      expect(closed["teardowns"]).toBe(1);
      expect(closed["handlers"]).toEqual(closed["before"]);
      // No process.exit in the library: the process ends because nothing is left running.
      const exit = await run.exited;
      expect(exit).toMatchObject({ code: 0, signal: null });
    }, 30_000);
  }
});
