import { afterEach, describe, expect, it, vi } from "vitest";
import { httpPreset } from "./http.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("httpPreset", () => {
  it("posts message JSON to the endpoint", async () => {
    const seen: { url: unknown; init: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init: unknown) => {
        seen.push({ url, init });
        await Promise.resolve();
        return new Response("{}", { status: 200 });
      }),
    );
    const sender = httpPreset({ url: "https://api.example.com/mail", from: "shelf@example.com" });
    await sender.send({ to: "a@example.com", subject: "s", text: "t" });
    expect(seen).toHaveLength(1);
    const init = seen[0]?.init as { body: string } | undefined;
    expect(init).toBeDefined();
    expect(JSON.parse(init!.body) as Record<string, unknown>).toMatchObject({
      to: "a@example.com",
      subject: "s",
    });
  });
});
