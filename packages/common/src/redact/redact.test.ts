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
    expect(redactSecrets("pat glpat-aB3_x-9Yz leaked")).toBe("pat [redacted] leaked");
  });

  it("redacts a presigned RDS IAM auth token", () => {
    const token =
      "db.example.rds.amazonaws.com:5432/?Action=connect&DBUser=app&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=abc%2F20261113%2Feu-west-1%2Frds-db%2Faws4_request&X-Amz-Signature=deadbeef01&X-Amz-Security-Token=tok123";
    const out = redactSecrets(`connect failed: ${token}`);
    expect(out).not.toContain("deadbeef01");
    expect(out).not.toContain("tok123");
    expect(out).not.toContain("abc%2F");
  });

  it("redacts an Anthropic API key embedded in an error", () => {
    const text = "401 from the provider for key sk-ant-api03-AbC_d-ef123SECRETSECRET (invalid)";
    const redacted = redactSecrets(text);

    expect(redacted).toBe("401 from the provider for key [redacted] (invalid)");
    expect(redacted).not.toContain("SECRET");
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

describe("redactSecrets: app tokens", () => {
  it("scrubs a signed JWT", () => {
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiIxMjM0NTYifQ.c2lnbmF0dXJl";
    expect(redactSecrets(`bad credentials ${jwt}`)).toBe("bad credentials [redacted]");
  });
});
