import { describe, expect, it, vi } from "vitest";
import type { ReviewThread } from "./comments.ts";
import { upsertReviewComment } from "./comments.ts";

function fakeThread(comments: { id: number; body: string }[] = []): ReviewThread & {
  created: string[];
  updated: { id: string | number; body: string }[];
} {
  const created: string[] = [];
  const updated: { id: string | number; body: string }[] = [];
  let nextId = 100;
  return {
    created,
    updated,
    list: async () => await Promise.resolve([...comments]),
    update: async (id, body) => {
      updated.push({ id, body });
      return await Promise.resolve(String(id));
    },
    create: async (body) => {
      created.push(body);
      nextId += 1;
      return await Promise.resolve(String(nextId));
    },
  };
}

/** Resolver for the no-thread case (empty lookup misses). */
async function resolveMissingNumber(): Promise<number | undefined> {
  await Promise.resolve();
  return ([] as number[]).at(0);
}

describe("upsertReviewComment", () => {
  it("creates a comment with the url marker when none exists", async () => {
    const thread = fakeThread();
    const resolveNumber = vi.fn(async () => await Promise.resolve(7));
    const id = await upsertReviewComment({
      url: "http://example.com/build/1",
      markdown: "Visual tests passed",
      sha: "abc",
      resolveNumber,
      thread: () => thread,
    });
    expect(id).toBe("101");
    expect(resolveNumber).toHaveBeenCalledOnce();
    expect(thread.created).toHaveLength(1);
    expect(thread.created[0]).toContain("<!-- storyshelf:http://example.com/build/1 -->");
    expect(thread.created[0]).toContain("Visual tests passed");
  });

  it("updates the existing marked comment instead of creating", async () => {
    const thread = fakeThread([{ id: 9, body: "<!-- storyshelf:http://x/1 -->\nold" }]);
    const id = await upsertReviewComment({
      url: "http://x/1",
      markdown: "new body",
      prNumber: 3,
      sha: "abc",
      resolveNumber: resolveMissingNumber,
      thread: () => thread,
    });
    expect(id).toBe("9");
    expect(thread.created).toHaveLength(0);
    expect(thread.updated).toEqual([{ id: 9, body: "<!-- storyshelf:http://x/1 -->\nnew body" }]);
  });

  it("returns empty string when no review thread exists", async () => {
    const thread = fakeThread();
    const id = await upsertReviewComment({
      url: "http://x/1",
      markdown: "hi",
      sha: "abc",
      resolveNumber: resolveMissingNumber,
      thread: () => thread,
    });
    expect(id).toBe("");
    expect(thread.created).toHaveLength(0);
  });

  it("rethrows thread errors to the caller", async () => {
    const thread: ReviewThread = {
      list: async () => await Promise.resolve([]),
      update: async () => await Promise.resolve("1"),
      create: async () => {
        await Promise.resolve();
        throw new Error("provider down");
      },
    };
    await expect(
      upsertReviewComment({
        url: "http://x/1",
        markdown: "hi",
        prNumber: 3,
        sha: "abc",
        resolveNumber: async () => await Promise.resolve(3),
        thread: () => thread,
      }),
    ).rejects.toThrow("provider down");
  });
});
