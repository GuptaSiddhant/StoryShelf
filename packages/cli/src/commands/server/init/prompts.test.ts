import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("prompts", () => ({
  default: vi.fn(),
}));

import prompts from "prompts";
import { collectAnswers, promptInitial } from "./prompts.ts";

let tmpRoot = "";
let cwd = "";

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "storyshelf-init-prompts-"));
  cwd = process.cwd();
  process.chdir(tmpRoot);
  vi.mocked(prompts).mockReset();
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
  rmSync(tmpRoot, { recursive: true, force: true });
});

const PROJECT = { name: "my-server", dir: "./my-server" };
const ADAPTERS = {
  database: "sqlite",
  storage: "local",
  auth: "none",
  git: "none",
  docker: false,
};

/** The questions of the n-th `prompts` call, by name. */
function asked(call: number): string[] {
  const [questions] = vi.mocked(prompts).mock.calls[call] ?? [];
  const list = Array.isArray(questions) ? questions : [questions];
  return list.map((question) => (question as { name?: string }).name ?? "");
}

/** Number of database choices the third prompt offers, with advanced adapters on or off. */
async function databaseChoices(advancedAdapters: boolean): Promise<number> {
  vi.mocked(prompts)
    .mockReset()
    .mockResolvedValueOnce({ ...PROJECT, deployTarget: "local" })
    .mockResolvedValueOnce({ advancedAdapters })
    .mockResolvedValueOnce({ ...ADAPTERS });
  await collectAnswers();
  const [questions] = vi.mocked(prompts).mock.calls[2] ?? [];
  const database = (questions as Array<{ name?: string; choices?: unknown[] }>).find(
    (question) => question.name === "database",
  );
  return database?.choices?.length ?? 0;
}

describe("promptInitial", () => {
  const choices = [{ value: "a" }, { value: "b" }];

  it("finds the index of a known value", () => {
    expect(promptInitial(choices, "b")).toBe(1);
  });

  it("is undefined for a missing, empty or unknown value", () => {
    expect(promptInitial(choices)).toBeUndefined();
    expect(promptInitial(choices, "")).toBeUndefined();
    expect(promptInitial(choices, "c")).toBeUndefined();
  });
});

describe("collectAnswers", () => {
  it("resolves null and writes nothing when the name or directory is missing", async () => {
    vi.mocked(prompts).mockResolvedValue({});
    expect(await collectAnswers()).toBeNull();
    vi.mocked(prompts).mockResolvedValue({ name: "x" });
    expect(await collectAnswers()).toBeNull();
    expect(vi.mocked(prompts)).toHaveBeenCalledTimes(2);
  });

  it("asks the project and target first, then the adapters on a local target", async () => {
    vi.mocked(prompts)
      .mockResolvedValueOnce({ ...PROJECT, deployTarget: "local" })
      .mockResolvedValueOnce({ advancedAdapters: false })
      .mockResolvedValueOnce({ ...ADAPTERS });
    const answers = await collectAnswers();
    expect(asked(0)).toContain("deployTarget");
    expect(asked(1)).toEqual(["advancedAdapters"]);
    expect(asked(2)).toContain("database");
    expect(answers).toMatchObject({ ...ADAPTERS, deployTarget: "local", advancedAdapters: false });
  });

  it("offers the curated four databases, or all fourteen with advanced adapters", async () => {
    expect(await databaseChoices(false)).toBe(4);
    expect(await databaseChoices(true)).toBe(14);
  });

  it("starts the database menu on the adapter found in the project's package.json", async () => {
    writeFileSync(
      join(tmpRoot, "package.json"),
      JSON.stringify({ dependencies: { "@storyshelf/db-sqlite": "1.0.0", "@libsql/client": "1" } }),
    );
    vi.mocked(prompts)
      .mockResolvedValueOnce({ ...PROJECT, deployTarget: "local" })
      .mockResolvedValueOnce({ advancedAdapters: true })
      .mockResolvedValueOnce({ ...ADAPTERS });
    await collectAnswers();
    const [questions] = vi.mocked(prompts).mock.calls[2] ?? [];
    const database = (questions as Array<{ name?: string; initial?: number }>).find(
      (question) => question.name === "database",
    );
    expect(typeof database?.initial).toBe("number");
  });

  it.each([
    ["aws", { database: "postgres", storage: "s3", docker: true }, "awsRegion"],
    ["azure", { database: "postgres", storage: "azure", docker: true }, "azureLocation"],
    ["gcp", { database: "postgres", storage: "gcs", docker: true }, "gcpLocation"],
  ] as const)(
    "pins the %s reference stack and asks its follow-ups",
    async (target, pinned, field) => {
      vi.mocked(prompts)
        .mockResolvedValueOnce({ ...PROJECT, deployTarget: target, ...ADAPTERS })
        .mockResolvedValueOnce({});
      const answers = await collectAnswers();
      expect(answers).toMatchObject(pinned);
      expect(asked(1)).toContain(field);
      // No adapter menu on a cloud target: two calls in all.
      expect(vi.mocked(prompts)).toHaveBeenCalledTimes(2);
    },
  );

  it("defaults the cloud follow-ups when they are left blank", async () => {
    vi.mocked(prompts)
      .mockResolvedValueOnce({ ...PROJECT, deployTarget: "aws" })
      .mockResolvedValueOnce({});
    expect(await collectAnswers()).toMatchObject({ awsRegion: "us-east-1" });
    vi.mocked(prompts)
      .mockResolvedValueOnce({ ...PROJECT, deployTarget: "azure" })
      .mockResolvedValueOnce({});
    expect(await collectAnswers()).toMatchObject({ azureLocation: "eastus" });
    vi.mocked(prompts)
      .mockResolvedValueOnce({ ...PROJECT, deployTarget: "gcp" })
      .mockResolvedValueOnce({});
    expect(await collectAnswers()).toMatchObject({ gcpLocation: "us-central1" });
  });

  it("asks no queue or worker question", async () => {
    vi.mocked(prompts)
      .mockResolvedValueOnce({ ...PROJECT, deployTarget: "docker" })
      .mockResolvedValueOnce({ advancedAdapters: false })
      .mockResolvedValueOnce({ ...ADAPTERS });
    await collectAnswers();
    const all = [0, 1, 2].flatMap((call) => asked(call));
    expect(all).not.toContain("queue");
    expect(all).not.toContain("includeWorker");
  });
});
