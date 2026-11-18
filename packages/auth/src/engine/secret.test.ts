import { describe, expect, it } from "vitest";
import { assertAuthSecret, MIN_AUTH_SECRET_LENGTH } from "./secret.ts";

describe("assertAuthSecret", () => {
  it.each([undefined, null, "", 42])("refuses a missing secret (%s), naming SECRET", (value) => {
    expect(() => {
      assertAuthSecret(value);
    }).toThrow(/SECRET .*unset/u);
  });

  it("refuses a secret shorter than 32 characters without echoing it", () => {
    const short = "x".repeat(MIN_AUTH_SECRET_LENGTH - 1);
    let message = "";
    try {
      assertAuthSecret(short);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/SECRET .*at least 32 characters/u);
    expect(message).not.toContain(short);
  });

  it("accepts a secret of 32 characters", () => {
    expect(() => {
      assertAuthSecret("y".repeat(MIN_AUTH_SECRET_LENGTH));
    }).not.toThrow();
  });
});
