import { describe, expect, it, vi } from "vitest";
import type { ReviewThread } from "./review-comment.ts";
import { listAllPages, PAGE_SIZE, upsertReviewComment } from "./review-comment.ts";

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
      project: "web",
      buildId: "01B",
      url: "http://example.com/projects/web/builds/01B/diff",
      markdown: "Visual tests passed",
      sha: "abc",
      resolveNumber,
      thread: () => thread,
    });
    expect(id).toBe("101");
    expect(resolveNumber).toHaveBeenCalledOnce();
    expect(thread.created).toHaveLength(1);
    expect(thread.created[0]).toContain("<!-- storyshelf:project=web -->");
    expect(thread.created[0]).toContain("Visual tests passed");
  });

  it("updates the existing marked comment instead of creating", async () => {
    const thread = fakeThread([
      { id: 9, body: "<!-- storyshelf:project=web -->\n<!-- storyshelf:build=01A -->\nold" },
    ]);
    const id = await upsertReviewComment({
      project: "web",
      buildId: "01B",
      url: "http://x/projects/web/builds/01B/diff",
      markdown: "new body",
      prNumber: 3,
      sha: "abc",
      resolveNumber: resolveMissingNumber,
      thread: () => thread,
    });
    expect(id).toBe("9");
    expect(thread.created).toHaveLength(0);
    expect(thread.updated).toEqual([
      { id: 9, body: "<!-- storyshelf:project=web -->\n<!-- storyshelf:build=01B -->\nnew body" },
    ]);
  });

  it("returns empty string when no review thread exists", async () => {
    const thread = fakeThread();
    const id = await upsertReviewComment({
      project: "web",
      buildId: "01B",
      url: "http://x/projects/web/builds/01B/diff",
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
        project: "web",
        buildId: "01B",
        url: "http://x/projects/web/builds/01B/diff",
        markdown: "hi",
        prNumber: 3,
        sha: "abc",
        resolveNumber: async () => await Promise.resolve(3),
        thread: () => thread,
      }),
    ).rejects.toThrow("provider down");
  });

  const base = {
    project: "web",
    buildId: "01B",
    url: "http://x/projects/web/builds/01B/diff",
    markdown: "new",
    prNumber: 3,
    sha: "abc",
    resolveNumber: resolveMissingNumber,
  };

  it("leaves a comment a newer build wrote", async () => {
    const thread = fakeThread([
      { id: 9, body: "<!-- storyshelf:project=web -->\n<!-- storyshelf:build=01C -->\nnewer" },
    ]);
    const id = await upsertReviewComment({ ...base, thread: () => thread });
    expect(id).toBe("9");
    expect(thread.updated).toHaveLength(0);
    expect(thread.created).toHaveLength(0);
  });

  it("keeps one comment per project", async () => {
    const thread = fakeThread([
      { id: 9, body: "<!-- storyshelf:project=other -->\n<!-- storyshelf:build=01A -->\nx" },
    ]);
    await upsertReviewComment({ ...base, thread: () => thread });
    expect(thread.created).toHaveLength(1);
    expect(thread.updated).toHaveLength(0);
  });

  it("adopts the newest pre-upgrade per-build comment of the project", async () => {
    const thread = fakeThread([
      { id: 5, body: "<!-- storyshelf:http://x/projects/web/builds/01A/diff -->\nold" },
      { id: 6, body: "<!-- storyshelf:http://x/projects/other/builds/01A/diff -->\nold" },
      { id: 7, body: "<!-- storyshelf:http://x/projects/web/builds/01Z/diff -->\nold" },
    ]);
    const id = await upsertReviewComment({ ...base, thread: () => thread });
    expect(id).toBe("7");
    expect(thread.updated.map((u) => u.id)).toEqual([7]);
    expect(thread.created).toHaveLength(0);
  });
});

describe("listAllPages", () => {
  it("follows pages until a short one", async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, index) => index);
    const pages = [full, full, [1, 2]];
    const fetchPage = vi.fn(async (page: number) => await Promise.resolve(pages[page - 1] ?? []));
    const all = await listAllPages(fetchPage);
    expect(all).toHaveLength(PAGE_SIZE * 2 + 2);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("stops at the page cap", async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, index) => index);
    const fetchPage = vi.fn(async () => await Promise.resolve(full));
    await listAllPages(fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(100);
  });
});
