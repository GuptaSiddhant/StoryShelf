import { describe, expect, it } from "vitest";
import { requireAuthOnFly } from "./require-auth.ts";

const fly = { FLY_APP_NAME: "storyshelf" };
const both = { SHELF_ADMIN_PASSWORD: "pw-value-123456", SHELF_SECRET: "secret-value-123456" };

describe("requireAuthOnFly", () => {
  it("boots with both settings on Fly", () => {
    expect(() => requireAuthOnFly({ ...fly, ...both })).not.toThrow();
  });

  it("refuses on Fly without SHELF_ADMIN_PASSWORD, naming only it", () => {
    expect(() => requireAuthOnFly({ ...fly, SHELF_SECRET: both.SHELF_SECRET })).toThrow(
      /Set SHELF_ADMIN_PASSWORD \(/u,
    );
  });

  it("refuses on Fly without SHELF_SECRET, naming only it, and never a value", () => {
    let message = "";
    try {
      requireAuthOnFly({ ...fly, SHELF_ADMIN_PASSWORD: both.SHELF_ADMIN_PASSWORD });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("Set SHELF_SECRET (");
    expect(message).not.toContain("SHELF_ADMIN_PASSWORD");
    expect(message).not.toContain(both.SHELF_ADMIN_PASSWORD);
  });

  it("names both when neither is set, and treats empty as missing", () => {
    expect(() => requireAuthOnFly({ ...fly, SHELF_ADMIN_PASSWORD: "" })).toThrow(
      "SHELF_ADMIN_PASSWORD and SHELF_SECRET",
    );
  });

  it("boots open on Fly only with SHELF_ALLOW_NO_AUTH=1", () => {
    expect(() => requireAuthOnFly({ ...fly, SHELF_ALLOW_NO_AUTH: "1" })).not.toThrow();
    expect(() => requireAuthOnFly({ ...fly, SHELF_ALLOW_NO_AUTH: "true" })).toThrow();
  });

  it("keeps auth off for a local run without FLY_APP_NAME", () => {
    expect(() => requireAuthOnFly({})).not.toThrow();
  });
});
