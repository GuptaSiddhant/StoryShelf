import { describe, expect, it } from "vitest";
import { designContractSuite } from "../../../test-helpers/index.ts";
import { createFigmaDesign, figmaOAuthFromEnv } from "./index.ts";

designContractSuite("figma", createFigmaDesign, {
  valid: { url: "https://www.figma.com/design/AbC123/Kit?node-id=1-2", fileKey: "AbC123" },
  invalid: "https://example.com/design/AbC123/Kit",
});

describe("the built-in Figma provider", () => {
  it("has OAuth only when the operator set a client id and secret", () => {
    expect(createFigmaDesign({ oauth: figmaOAuthFromEnv({}) }).oauth).toBeUndefined();
    const env = { FIGMA_CLIENT_ID: "id", FIGMA_CLIENT_SECRET: "secret" };
    expect(createFigmaDesign({ oauth: figmaOAuthFromEnv(env) }).oauth).toBeDefined();
  });
});
