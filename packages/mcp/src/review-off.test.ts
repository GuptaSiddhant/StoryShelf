import { describe, expect, it, vi } from "vitest";
import { ToolError, type ApiClient } from "./client.ts";
import { REVIEW_OFF_MESSAGE, explainFailure } from "./review-off.ts";
import type { ToolDef } from "./tools/types.ts";

const tool = (routeClass?: ToolDef["routeClass"]): ToolDef => ({
  name: "t",
  title: "t",
  description: "t",
  readOnly: true,
  ...(routeClass === undefined ? {} : { routeClass }),
  input: {},
  run: async () => await Promise.resolve(null),
});

const notFound = new ToolError(
  "StoryShelf API: not found: check the project slug and build id",
  404,
);

function clientWith(get: ApiClient["get"]): ApiClient {
  return { defaultSlug: "web", get, post: vi.fn() };
}

describe("explainFailure", () => {
  it("says review is off when a review tool meets a 404 and the project has review off", async () => {
    const get = vi.fn().mockResolvedValue({ reviewEnabled: false });
    const result = await explainFailure(clientWith(get), tool("review"), {}, notFound);
    expect(result.message).toBe(REVIEW_OFF_MESSAGE);
    expect(get).toHaveBeenCalledWith("/projects/web");
  });

  it("uses the project the call named", async () => {
    const get = vi.fn().mockResolvedValue({ reviewEnabled: false });
    await explainFailure(clientWith(get), tool("review"), { project: "other" }, notFound);
    expect(get).toHaveBeenCalledWith("/projects/other");
  });

  it("keeps the 404 when review is on, so a wrong build id still reads as not found", async () => {
    const get = vi.fn().mockResolvedValue({ reviewEnabled: true });
    expect(await explainFailure(clientWith(get), tool("review"), {}, notFound)).toBe(notFound);
  });

  it("keeps the 404 when the project does not say, or cannot be read", async () => {
    const silent = vi.fn().mockResolvedValue({});
    expect(await explainFailure(clientWith(silent), tool("review"), {}, notFound)).toBe(notFound);
    const missing = vi.fn().mockRejectedValue(new ToolError("StoryShelf API: not found", 404));
    expect(await explainFailure(clientWith(missing), tool("review"), {}, notFound)).toBe(notFound);
  });

  it("keeps the 404 when no project is given, without asking", async () => {
    const get = vi.fn();
    const noDefault: ApiClient = { defaultSlug: undefined, get, post: vi.fn() };
    expect(await explainFailure(noDefault, tool("review"), {}, notFound)).toBe(notFound);
    expect(get).not.toHaveBeenCalled();
  });

  it("leaves other statuses and other tools alone, without asking", async () => {
    const get = vi.fn();
    const forbidden = new ToolError("StoryShelf API: forbidden", 403);
    expect(await explainFailure(clientWith(get), tool("review"), {}, forbidden)).toBe(forbidden);
    expect(await explainFailure(clientWith(get), tool(), {}, notFound)).toBe(notFound);
    expect(await explainFailure(clientWith(get), tool("testing"), {}, notFound)).toBe(notFound);
    expect(get).not.toHaveBeenCalled();
  });
});
