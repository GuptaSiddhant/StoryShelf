import type { StoryEntry } from "@storyshelf/core/adapter/capture-runner";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createPuppeteerCaptureRunner } from "./capture-runner.ts";

/**
 * Real-browser axe check against a built fixture Storybook (`FIXTURE_DIR`, default storybook-8).
 * Needs a Chrome: set `PUPPETEER_EXECUTABLE_PATH` (puppeteer-core ships no browser).
 */
const FIXTURE_DIR = process.env["FIXTURE_DIR"]
  ? resolve(process.env["FIXTURE_DIR"])
  : resolve(import.meta.dirname ?? ".", "..", "..", "..", "fixtures", "storybook-8");

const CHROME = process.env["PUPPETEER_EXECUTABLE_PATH"];

function story(id: string): StoryEntry {
  return { id, title: id, name: id, type: "story" };
}

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")("axe in the Puppeteer runner", () => {
  it("annotates violations, honours parameters.a11y, and leaves clean stories alone", async () => {
    const ids = [
      "components-accessibility--missing-alt",
      "components-accessibility--low-contrast",
      "components-accessibility--clean",
      "components-accessibility--disabled-a11y",
      "components-accessibility--rule-override",
      "components-accessibility--best-practice",
      "components-button--primary",
    ];
    const rendered = await createPuppeteerCaptureRunner({
      concurrency: 1,
      ...(CHROME ? { executablePath: CHROME } : {}),
    }).render({
      buildId: "a11y-puppeteer",
      storybookDir: join(FIXTURE_DIR, "storybook-static"),
      stories: ids.map((id) => story(id)),
      viewports: [{ name: "desktop", width: 1280, height: 720 }],
      runA11y: true,
    });
    const annotation = (id: string): string =>
      rendered.failures.find((failure) => failure.storyId === id)?.error ?? "";
    expect(rendered.captures).toHaveLength(ids.length);
    expect(annotation("components-accessibility--missing-alt")).toMatch(
      /^a11y: .*image-alt \(critical\)/u,
    );
    expect(annotation("components-accessibility--missing-alt")).toContain("button-name");
    expect(annotation("components-accessibility--low-contrast")).toContain("color-contrast");
    // The default run set includes best-practice rules.
    expect(annotation("components-accessibility--best-practice")).toContain("heading-order");
    expect(annotation("components-accessibility--clean")).toBe("");
    expect(annotation("components-accessibility--disabled-a11y")).toBe("");
    expect(annotation("components-button--primary")).toBe("");
    expect(annotation("components-accessibility--rule-override")).toContain("button-name");
    expect(annotation("components-accessibility--rule-override")).not.toContain("image-alt");
    // Annotations only: the render itself reports no non-a11y failure.
    expect(rendered.failures.every((failure) => failure.error.startsWith("a11y:"))).toBe(true);
  }, 120_000);
});
