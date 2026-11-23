import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  new URL("../src/content/docs/guides/custom-adapters.md", import.meta.url),
  "utf8",
);
const blocks = [...page.matchAll(/^```ts title="([^"]+)"\n([\s\S]*?)\n```$/gmu)];

describe("custom adapters guide", () => {
  it("shows every example file", () => {
    expect(blocks.map((block) => block[1]).toSorted()).toEqual([
      "fake-kv-service.ts",
      "kv-storage.test.ts",
      "kv-storage.ts",
      "webhook-notifier.test.ts",
      "webhook-notifier.ts",
      "wire.ts",
    ]);
  });

  it.each(blocks.map((block) => [block[1], block[2]] as const))(
    "matches %s in the fixture",
    (name, shown) => {
      const file = readFileSync(new URL(`./custom-adapters/${name}`, import.meta.url), "utf8");
      expect(shown).toBe(file.trimEnd());
    },
  );
});
