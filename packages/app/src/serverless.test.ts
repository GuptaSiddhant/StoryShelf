import { describe, expect, it } from "vitest";
import { isServerlessHost } from "./serverless.ts";

describe("isServerlessHost", () => {
  it("is false on a plain host", () => {
    expect(isServerlessHost({})).toBe(false);
    expect(isServerlessHost({ VERCEL: "" })).toBe(false);
  });

  it.each(["AWS_LAMBDA_FUNCTION_NAME", "VERCEL", "NETLIFY"])("is true when %s is set", (name) => {
    expect(isServerlessHost({ [name]: "1" })).toBe(true);
  });
});
