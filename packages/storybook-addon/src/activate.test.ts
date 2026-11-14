import { describe, expect, it, vi } from "vitest";
import { activate, type PageEnv } from "./activate.ts";
import type { Fetcher } from "./client.ts";

vi.mock("react", async () => await import("./react-fake.ts"));

const PATH = "/projects/gate/storybook/build/b1/";
const body = {
  build: { status: "reviewing", reviewPath: "/projects/gate/builds/b1/diff" },
  stories: { "a--one": { status: "changed" } },
};

function env(over: Partial<PageEnv> = {}): { env: PageEnv; fetcher: ReturnType<typeof vi.fn> } {
  const fetcher = vi.fn(async (input: string) =>
    input.endsWith("/health") ? Response.json({ testing: true }) : Response.json(body),
  );
  return {
    fetcher,
    env: {
      origin: "https://shelf.example",
      pathname: PATH,
      fetcher: fetcher as unknown as Fetcher,
      open: vi.fn(),
      ...over,
    },
  };
}

describe("activate", () => {
  it("sets the label renderer, then reads the status, on a published build", async () => {
    const host = { setConfig: vi.fn() };
    const page = env();
    expect(await activate(host, page.env)).toBe(true);
    expect(host.setConfig).toHaveBeenCalledOnce();
    expect(page.fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a sandboxed page", { origin: "null" }],
    ["a local storybook dev", { pathname: "/" }],
    ["a short link", { pathname: "/_/abc/" }],
  ])("makes no request and changes nothing on %s", async (_name, over) => {
    const host = { setConfig: vi.fn() };
    const page = env(over);
    expect(await activate(host, page.env)).toBe(false);
    expect(page.fetcher).not.toHaveBeenCalled();
    expect(host.setConfig).not.toHaveBeenCalled();
  });

  it("keeps the renderer, with no badges, when there is no status", async () => {
    const host = { setConfig: vi.fn() };
    const page = env({
      fetcher: async () => await Promise.resolve(new Response("", { status: 404 })),
    });
    expect(await activate(host, page.env)).toBe(false);
    expect(host.setConfig).toHaveBeenCalledOnce();
  });

  it("shows no badge when the review path leaves the origin", async () => {
    const host = { setConfig: vi.fn() };
    const evil = { ...body, build: { ...body.build, reviewPath: "//evil.example/x" } };
    const page = env({
      fetcher: async (input: string) =>
        await Promise.resolve(
          input.endsWith("/health") ? Response.json({ testing: true }) : Response.json(evil),
        ),
    });
    expect(await activate(host, page.env)).toBe(false);
  });
});
