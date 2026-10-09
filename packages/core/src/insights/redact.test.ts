import { describe, expect, it } from "vitest";
import { redactText } from "./redact.ts";

describe("redactText", () => {
  it.each([
    ["password=hunter2 next", "hunter2"],
    ['{"apiKey": "abc123secret"}', "abc123secret"],
    ["Authorization: Bearer abcdefgh12345678", "abcdefgh12345678"],
    ["https://user:pa55word@example.com/x", "pa55word"],
    ["token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig", "eyJhbGciOiJIUzI1NiJ9"],
    ["key sk-abcdefghijklmnop", "sk-abcdefghijklmnop"],
    ["id AKIAABCDEFGHIJKLMNOP", "AKIAABCDEFGHIJKLMNOP"],
    ["blob 0123456789abcdef0123456789abcdef0123", "0123456789abcdef0123456789abcdef0123"],
  ])("redacts %s", (input, secret) => {
    const out = redactText(input);
    expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED]");
  });

  it("leaves ordinary paths, names and short ids alone", () => {
    const text = "src/components/Button/Button.stories.tsx Button/Primary@desktop sha 1a2b3c";
    expect(redactText(text)).toBe(text);
  });
});
