import { describe, expect, it } from "vitest";
import * as api from "./index.ts";

describe("public exports", () => {
  it("exports createCaptureRunner and no alias for the old factory name", () => {
    expect(api.createCaptureRunner).toBeTypeOf("function");
    expect(Reflect.has(api, "createPlaywrightCaptureRunner")).toBe(false);
  });
});
