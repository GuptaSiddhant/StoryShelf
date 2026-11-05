import { describe, expect, it } from "vitest";
import { UserFacingError, isUserFacingError } from "./user-facing-error.ts";

describe("UserFacingError", () => {
  it("is an Error carrying its message and a name", () => {
    const error = new UserFacingError("A label type with this key already exists");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("A label type with this key already exists");
    expect(error.name).toBe("UserFacingError");
  });

  it("keeps the cause it was given", () => {
    const cause = new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed");
    expect(new UserFacingError("Already exists", { cause }).cause).toBe(cause);
  });

  it("is recognised by isUserFacingError, and nothing else is", () => {
    expect(isUserFacingError(new UserFacingError("x"))).toBe(true);
    expect(isUserFacingError(new Error("x"))).toBe(false);
    expect(isUserFacingError("x")).toBe(false);
    expect(isUserFacingError(null)).toBe(false);
  });
});
