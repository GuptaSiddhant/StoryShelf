import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectFiles } from "./check-files.mjs";

describe("selectFiles", () => {
  const tracked = [
    "scripts/clean.mjs",
    "packages/app/scripts/embed-htmx.ts",
    "packages/app/src/ui/button.tsx",
    "package.json",
    "docs/adr/0013-ui-review.md",
    "fixtures/storybook-9/src/Button.tsx",
    "fixtures/storybook-9/package.json",
    "apps/website/src/styles.css",
  ];

  it("lints code files and format-checks code and JSON, including ones outside a package's src", () => {
    const { format, lint } = selectFiles(tracked);
    assert.deepEqual(lint, [
      "scripts/clean.mjs",
      "packages/app/scripts/embed-htmx.ts",
      "packages/app/src/ui/button.tsx",
    ]);
    assert.deepEqual(format, [...lint, "package.json"]);
  });

  it("leaves out the fixtures, which stand in for a customer's code", () => {
    const { format, lint } = selectFiles(tracked);
    assert.equal(
      [...format, ...lint].some((file) => file.startsWith("fixtures/")),
      false,
    );
  });

  it("ignores files the hook does not check", () => {
    const { format } = selectFiles(["README.md", "a.css", "b.yml"]);
    assert.deepEqual(format, []);
  });
});
