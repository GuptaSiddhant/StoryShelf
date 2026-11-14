import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestError } from "../client.ts";
import { decideSuperseded, findSupersedes } from "./supersede.ts";

const run = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

let root: string;
let origin: string;
let work: string;

function commit(cwd: string, name: string): string {
  writeFileSync(join(cwd, name), name);
  run(cwd, "add", name);
  run(cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", name);
  return run(cwd, "rev-parse", "HEAD");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "supersede-"));
  origin = join(root, "origin.git");
  work = join(root, "work");
  run(root, "init", "--bare", "-b", "main", origin);
  run(root, "clone", origin, work);
  run(work, "checkout", "-b", "main");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("decideSuperseded (real git repository)", () => {
  it("supersedes an ancestor and keeps the same commit", () => {
    const first = commit(work, "a");
    const head = commit(work, "b");
    const decision = decideSuperseded(
      [
        { id: "old", sha: first },
        { id: "same", sha: head },
      ],
      { cwd: work, branch: "main", headSha: head },
    );
    expect(decision).toEqual({ superseded: ["old"], undecided: 0 });
  });

  it("keeps a descendant of HEAD (a re-run of an old commit)", () => {
    const old = commit(work, "a");
    const newer = commit(work, "b");
    const decision = decideSuperseded([{ id: "new", sha: newer }], {
      cwd: work,
      branch: "main",
      headSha: old,
    });
    expect(decision).toEqual({ superseded: [], undecided: 0 });
  });

  it("supersedes a force-pushed-away commit when HEAD is the remote tip", () => {
    const base = commit(work, "a");
    const gone = commit(work, "b");
    run(work, "push", "origin", "main");
    run(work, "reset", "--hard", base);
    const head = commit(work, "c");
    run(work, "push", "--force", "origin", "main");
    const fresh = join(root, "fresh");
    run(root, "clone", `file://${origin}`, fresh);
    expect(() => run(fresh, "cat-file", "-e", `${gone}^{commit}`)).toThrow();
    const decision = decideSuperseded([{ id: "gone", sha: gone }], {
      cwd: fresh,
      branch: "main",
      headSha: head,
    });
    expect(decision).toEqual({ superseded: ["gone"], undecided: 0 });
  });

  it("keeps a missing commit when HEAD is not the remote tip", () => {
    const head = commit(work, "a");
    run(work, "push", "origin", "main");
    const decision = decideSuperseded([{ id: "x", sha: "f".repeat(40) }], {
      cwd: work,
      branch: "main",
      headSha: `${head.slice(0, 39)}0`,
    });
    expect(decision).toEqual({ superseded: [], undecided: 1 });
  });

  it("keeps a missing commit in a shallow clone whose HEAD is behind the remote tip", () => {
    const missing = commit(work, "a");
    commit(work, "b");
    run(work, "push", "origin", "main");
    const shallow = join(root, "shallow");
    run(root, "clone", "--depth", "1", `file://${origin}`, shallow);
    const head = run(shallow, "rev-parse", "HEAD");
    commit(work, "c");
    run(work, "push", "origin", "main");
    const decision = decideSuperseded([{ id: "x", sha: missing }], {
      cwd: shallow,
      branch: "main",
      headSha: head,
    });
    expect(decision).toEqual({ superseded: [], undecided: 1 });
  });

  it("keeps everything on a git error", () => {
    const decision = decideSuperseded([{ id: "x", sha: "abc" }], {
      cwd: work,
      branch: "main",
      headSha: "def",
      git: () => ({ status: -1, stdout: "" }),
    });
    expect(decision).toEqual({ superseded: [], undecided: 0 });
  });
});

const client = (inFlight: () => Promise<{ id: string; sha: string }[]>) =>
  ({ projects: { builds: { inFlight } } }) as never;

describe("findSupersedes", () => {
  it("returns the superseded ids", async () => {
    const first = commit(work, "a");
    const head = commit(work, "b");
    const ids = await findSupersedes(
      client(async () => [{ id: "old", sha: first }]),
      {
        slug: "p",
        cwd: work,
        branch: "main",
        headSha: head,
      },
    );
    expect(ids).toEqual(["old"]);
  });

  it("sends nothing on a 404", async () => {
    const ids = await findSupersedes(
      client(async () => {
        throw new RequestError(404, "not found");
      }),
      { slug: "p", cwd: work, branch: "main", headSha: "x" },
    );
    expect(ids).toBeUndefined();
  });

  it("never throws on another failure", async () => {
    const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const ids = await findSupersedes(
      client(async () => {
        throw new Error("boom");
      }),
      { slug: "p", cwd: work, branch: "main", headSha: "x" },
    );
    log.mockRestore();
    expect(ids).toBeUndefined();
  });
});
