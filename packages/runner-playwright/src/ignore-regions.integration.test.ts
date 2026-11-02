import type { StoryEntry } from "@storyshelf/core/adapter/capture-runner";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlaywrightCaptureRunner } from "./capture-runner.ts";

/**
 * Real-browser check of ignore regions (#456) in the Playwright runner: a value that changes on
 * every load, inside a masked element, must not change the screenshot. The page is a one-file
 * "Storybook" so the test needs no fixture build. The unmasked control proves the value does
 * change the picture, so the equality assertions mean something.
 */
const viewports = [{ name: "desktop", width: 400, height: 200 }];

const story = (id: string, ignoreSelectors?: string[]): StoryEntry => ({
  id,
  title: id,
  name: id,
  type: "story",
  ...(ignoreSelectors ? { parameters: { ignoreSelectors } } : {}),
});

/** Each load writes fresh digits into the box the story id names. */
const PAGE = `<!doctype html><html><body style="margin:0;font:24px monospace">
<div id="storybook-root" style="width:380px;height:120px"></div>
<script>
  const id = new URL(location.href).searchParams.get("id");
  const digits = Array.from({ length: 14 }, () => Math.floor(Math.random() * 10)).join("");
  const root = document.getElementById("storybook-root");
  const box = document.createElement("div");
  box.textContent = digits;
  if (id === "ignore--attribute") box.setAttribute("data-storyshelf-ignore", "");
  if (id === "ignore--selector") box.className = "clock";
  if (id === "ignore--descendant") {
    // The mask is on the parent; the child overrides it, as a popover or portal might.
    box.setAttribute("data-storyshelf-ignore", "");
    box.textContent = "";
    const child = document.createElement("span");
    child.style.visibility = "visible";
    child.textContent = digits;
    box.append(child);
  }
  root.append(box);
</script></body></html>`;

let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "storyshelf-ignore-"));
  await writeFile(join(dir, "iframe.html"), PAGE);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function shotOf(input: StoryEntry, buildId: string): Promise<string> {
  const result = await createPlaywrightCaptureRunner().render({
    buildId,
    storybookDir: dir,
    stories: [input],
    viewports,
  });
  expect(result.failures).toEqual([]);
  expect(result.captures).toHaveLength(1);
  return result.captures[0]?.screenshot.toString("base64") ?? "";
}

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")("ignore regions (Playwright)", () => {
  it("shows that unmasked changing content does change the screenshot (control)", async () => {
    const first = await shotOf(story("ignore--control"), "ignore-control-1");
    const second = await shotOf(story("ignore--control"), "ignore-control-2");
    expect(second).not.toEqual(first);
  }, 120_000);

  it("masks an element marked with data-storyshelf-ignore", async () => {
    const first = await shotOf(story("ignore--attribute"), "ignore-attr-1");
    const second = await shotOf(story("ignore--attribute"), "ignore-attr-2");
    expect(second).toEqual(first);
  }, 120_000);

  it("masks elements matched by parameters.storyshelf.ignoreSelectors", async () => {
    const first = await shotOf(story("ignore--selector", [".clock"]), "ignore-sel-1");
    const second = await shotOf(story("ignore--selector", [".clock"]), "ignore-sel-2");
    expect(second).toEqual(first);
  }, 120_000);

  it("hides a descendant that sets visibility: visible inside an ignored element", async () => {
    const first = await shotOf(story("ignore--descendant"), "ignore-desc-1");
    const second = await shotOf(story("ignore--descendant"), "ignore-desc-2");
    expect(second).toEqual(first);
  }, 120_000);

  it("skips an invalid selector instead of failing the build", async () => {
    const first = await shotOf(story("ignore--selector", ["[", ".clock"]), "ignore-bad-1");
    const second = await shotOf(story("ignore--selector", ["[", ".clock"]), "ignore-bad-2");
    expect(first).not.toEqual("");
    expect(second).toEqual(first);
  }, 120_000);
});
