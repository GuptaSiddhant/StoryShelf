import { afterEach, describe, expect, it, vi } from "vitest";

import { postFormWithProgress } from "./client.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postFormWithProgress", () => {
  it("posts the form and returns the parsed JSON response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "01JABC" }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.set("gitSha", "abc123");
    form.set("gitBranch", "main");

    const result = await postFormWithProgress<{ id: string }>(
      "https://shelf.test/api/v1/projects/demo/builds",
      form,
      { authorization: "Bearer token" },
    );

    expect(result.id).toBe("01JABC");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://shelf.test/api/v1/projects/demo/builds",
      expect.objectContaining({ method: "POST", body: form }),
    );
  });

  it("throws when the server responds with an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 400 })));
    const form = new FormData();

    await expect(postFormWithProgress("https://shelf.test/projects/demo/builds", form)).rejects.toThrow(
      /Request failed \(400\): boom/u,
    );
  });
});