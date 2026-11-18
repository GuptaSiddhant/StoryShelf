import { describe, expect, it } from "vitest";
import {
  assertAuthSecret,
  assertNoLibrarySecretOverride,
  MIN_AUTH_SECRET_LENGTH,
} from "./secret.ts";

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

describe("assertNoLibrarySecretOverride", () => {
  it("refuses BETTER_AUTH_SECRETS, which would replace SECRET as the signing key", () => {
    const value = "1:a-different-signing-key-that-is-long-enough";
    expect(() => {
      assertNoLibrarySecretOverride({ BETTER_AUTH_SECRETS: value });
    }).toThrow(expect.objectContaining({ message: expect.not.stringContaining(value) }));
    expect(() => {
      assertNoLibrarySecretOverride({ BETTER_AUTH_SECRETS: value });
    }).toThrow(/BETTER_AUTH_SECRETS is set/u);
  });

  it("accepts an environment without it", () => {
    expect(() => {
      assertNoLibrarySecretOverride({});
    }).not.toThrow();
    expect(() => {
      assertNoLibrarySecretOverride({ BETTER_AUTH_SECRETS: "" });
    }).not.toThrow();
  });
});
