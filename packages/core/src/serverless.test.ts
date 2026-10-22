import { describe, expect, it } from "vitest";
import { assertServerless, isServerlessHost } from "./serverless.ts";

describe("isServerlessHost", () => {
  it("is false on a plain host", () => {
    expect(isServerlessHost({})).toBe(false);
    expect(isServerlessHost({ VERCEL: "" })).toBe(false);
  });

  it.each(["AWS_LAMBDA_FUNCTION_NAME", "VERCEL", "NETLIFY"])("is true when %s is set", (name) => {
    expect(isServerlessHost({ [name]: "1" })).toBe(true);
  });
});

describe("assertServerless", () => {
  it("says nothing on a plain host or without testing", () => {
    expect(assertServerless(true, {})).toBeUndefined();
    expect(
      assertServerless(false, { AWS_LAMBDA_FUNCTION_NAME: "fn", VERCEL: "1" }),
    ).toBeUndefined();
  });

  it("refuses testing on AWS Lambda", () => {
    expect(() => assertServerless(true, { AWS_LAMBDA_FUNCTION_NAME: "fn" })).toThrow(
      /AWS Lambda.*STORYSHELF_ALLOW_SERVERLESS=1/u,
    );
  });

  it("warns about testing on Vercel and Netlify", () => {
    expect(assertServerless(true, { VERCEL: "1" })).toMatch(/serverless host/u);
    expect(assertServerless(true, { NETLIFY: "true" })).toMatch(/serverless host/u);
  });

  it("is overridden by STORYSHELF_ALLOW_SERVERLESS=1 only", () => {
    expect(
      assertServerless(true, { AWS_LAMBDA_FUNCTION_NAME: "fn", STORYSHELF_ALLOW_SERVERLESS: "1" }),
    ).toBeUndefined();
    expect(() =>
      assertServerless(true, { AWS_LAMBDA_FUNCTION_NAME: "fn", STORYSHELF_ALLOW_SERVERLESS: "0" }),
    ).toThrow();
  });
});
