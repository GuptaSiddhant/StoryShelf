import { designContractSuite } from "@storyshelf/core/test-helpers";
import { createFigmaDesign } from "./index.ts";

designContractSuite("figma", createFigmaDesign, {
  valid: { url: "https://www.figma.com/design/AbC123/Kit?node-id=1-2", fileKey: "AbC123" },
  invalid: "https://example.com/design/AbC123/Kit",
});
