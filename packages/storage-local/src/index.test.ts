import { createLocalStorage as builtIn } from "@storyshelf/core/storage/local";
import { describe, expect, it } from "vitest";
import { createLocalStorage } from "./index.ts";

describe("deprecated re-export", () => {
  it("is the factory built into core", () => {
    expect(createLocalStorage).toBe(builtIn);
  });
});
