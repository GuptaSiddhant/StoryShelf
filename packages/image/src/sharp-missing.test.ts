import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("sharp");
  vi.resetModules();
});

describe("createSharpCodec without the optional peer", () => {
  it("explains how to install sharp and keeps the cause", async () => {
    vi.resetModules();
    vi.doMock("sharp", () => {
      throw new Error("Cannot find package 'sharp'");
    });
    const { createSharpCodec } = await import("./sharp.ts");
    const failure = await createSharpCodec().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/optional `sharp` package/u);
    expect((failure as Error).cause).toBeInstanceOf(Error);
  });
});
