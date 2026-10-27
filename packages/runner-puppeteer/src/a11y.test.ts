import { describe, expect, it, vi } from "vitest";
import { checkA11y } from "./a11y.ts";

const SLIM = {
  id: "image-alt",
  impact: "critical",
  help: "Images must have alternative text",
  target: "img",
  count: 2,
};

function fakePage(...results: unknown[]) {
  const evaluate = vi.fn();
  for (const result of results) {
    if (result instanceof Error) evaluate.mockRejectedValueOnce(result);
    else evaluate.mockResolvedValueOnce(result);
  }
  return { page: { evaluate } as never, evaluate };
}

describe("checkA11y", () => {
  it("reads parameters, injects axe, runs it and maps the violations", async () => {
    const { page, evaluate } = fakePage(
      { params: { options: { runOnly: ["image-alt"] } }, dropped: 0 },
      undefined,
      [SLIM],
    );
    await expect(checkA11y(page)).resolves.toEqual([
      "image-alt (critical): Images must have alternative text [img] 2 nodes",
    ]);
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(evaluate.mock.calls[1]?.[0]).toContain("axe");
    const plan = evaluate.mock.calls[2]?.[1] as {
      context: string;
      options: Record<string, unknown>;
    };
    expect(plan.context).toBe("#storybook-root");
    expect(plan.options["runOnly"]).toEqual(["image-alt"]);
  });

  it("is clean when axe finds nothing", async () => {
    const { page } = fakePage(undefined, undefined, []);
    await expect(checkA11y(page)).resolves.toEqual([]);
  });

  it.each([{ disable: true }, { test: "off" }])(
    "skips the story for %o without injecting axe",
    async (params) => {
      const { page, evaluate } = fakePage({ params, dropped: 0 });
      await expect(checkA11y(page)).resolves.toEqual([]);
      expect(evaluate).toHaveBeenCalledTimes(1);
    },
  );

  it("warns with the story id and count when values were dropped", async () => {
    const { page } = fakePage({ params: {}, dropped: 2 }, undefined, []);
    const warn = vi.fn();
    await checkA11y(page, { warn } as never, "button--primary");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toEqual({ storyId: "button--primary", dropped: 2 });
  });

  it("does not warn when no values were dropped", async () => {
    const { page } = fakePage({ params: {}, dropped: 0 }, undefined, []);
    const warn = vi.fn();
    await checkA11y(page, { warn } as never, "button--primary");
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when the entire parameter was omitted", async () => {
    const { page } = fakePage({ params: undefined, dropped: 1 }, undefined, []);
    const warn = vi.fn();
    await checkA11y(page, { warn } as never, "button--primary");
    expect(warn).toHaveBeenCalledWith(
      { storyId: "button--primary", dropped: 1 },
      expect.stringContaining("omitted"),
    );
  });

  it("reports one visible annotation when injection fails", async () => {
    const { page } = fakePage(undefined, new Error("Execution context was destroyed"));
    await expect(checkA11y(page)).resolves.toEqual([
      "axe unavailable: Execution context was destroyed",
    ]);
  });

  it("reports one visible annotation when the run throws", async () => {
    const { page } = fakePage(undefined, undefined, new Error("boom"));
    await expect(checkA11y(page)).resolves.toEqual(["axe unavailable: boom"]);
  });
});
