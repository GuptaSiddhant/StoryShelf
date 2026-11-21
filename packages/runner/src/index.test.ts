import { describe, expect, it } from "vitest";
import * as api from "./index.ts";

describe("public exports", () => {
  it("keeps the old factory name as an alias of createCaptureRunner", () => {
    expect(Reflect.get(api, "createPlaywrightCaptureRunner")).toBe(api.createCaptureRunner);
  });
});
