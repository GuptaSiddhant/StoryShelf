import { describe, expect, it } from "vitest";
import { redactSecrets, sanitizeErrorText } from "./redact.ts";

describe("redactSecrets", () => {
  it("redacts URL credentials", () => {
    expect(redactSecrets("connect postgres://user:s3cret@host/db")).toBe(
      "connect postgres://[redacted]@host/db",
    );
  });

  it("redacts token query params", () => {
    expect(redactSecrets("https://x.test/cb?token=abc123&next=/")).toBe(
      "https://x.test/cb?token=[redacted]&next=/",
    );
  });

  it("redacts key=value assignments", () => {
    expect(redactSecrets('client_secret="hunter2" failed')).toBe(
      'client_secret="[redacted]" failed',
    );
    expect(redactSecrets("token=abc123 leaked")).toBe("token=[redacted] leaked");
  });

  it("redacts provider key prefixes", () => {
    expect(redactSecrets("key AKIAIOSFODNN7EXAMPLE leaked")).toBe("key [redacted] leaked");
    expect(redactSecrets("pat ghp_abcDEF123 leaked")).toBe("pat [redacted] leaked");
  });

  it("leaves clean text untouched", () => {
    expect(redactSecrets("db down")).toBe("db down");
  });
});

describe("sanitizeErrorText", () => {
  it("redacts before truncating", () => {
    const text = `db down postgres://user:s3cret@host/db ${"x".repeat(100)}`;
    const out = sanitizeErrorText(text, 20);
    expect(out).toHaveLength(20);
    expect(out).not.toContain("s3cret");
  });
});
