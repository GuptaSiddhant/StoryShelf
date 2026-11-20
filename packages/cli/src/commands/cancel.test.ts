import { afterEach, describe, expect, it, vi } from "vitest";
import { runCancel } from "./cancel.ts";

const connection = { url: "https://shelf.test", slug: "web", token: "t", cwd: "/nonexistent" };

/** Stub fetch with one answer; returns the requests it received. */
function stubFetch(answer: unknown): { url: string; body: unknown }[] {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return await Promise.resolve(Response.json(answer));
    }),
  );
  return calls;
}

function capture(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runCancel", () => {
  it("a dry run asks the server to only list, and prints what would be cancelled", async () => {
    const calls = stubFetch({ cancelled: ["b1", "b2"], count: 2, dryRun: true });
    const lines = capture();
    await runCancel({ ...connection, dryRun: true, branch: "main", keepNewest: "2" });
    expect(calls).toEqual([
      {
        url: "https://shelf.test/api/v1/projects/web/builds/cancel",
        body: { branch: "main", keepNewest: 2, dryRun: true },
      },
    ]);
    expect(lines.join("")).toContain("Would cancel 2 build(s):");
    expect(lines.join("")).toContain("  b1");
  });

  it("cancels for real and says so", async () => {
    const calls = stubFetch({ cancelled: ["b1"], count: 1, dryRun: false });
    const lines = capture();
    await runCancel(connection);
    expect(calls[0]?.body).toEqual({ dryRun: false });
    expect(lines.join("")).toContain("Cancelled 1 build(s):");
  });

  it("says when there is nothing to cancel", async () => {
    stubFetch({ cancelled: [], count: 0, dryRun: false });
    const lines = capture();
    await runCancel(connection);
    expect(lines.join("")).toContain("No older unfinished builds to cancel");
  });

  it("refuses a keep-newest that is not a whole number, before any request", async () => {
    const calls = stubFetch({});
    await expect(runCancel({ ...connection, keepNewest: "-1" })).rejects.toThrow(/keep-newest/u);
    expect(calls).toEqual([]);
  });
});
