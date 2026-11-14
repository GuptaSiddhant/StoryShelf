import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => await import("./react-fake.ts"));

const setConfig = vi.hoisted(() => vi.fn());
vi.mock("./manager-api.ts", () => ({ addons: { setConfig } }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  setConfig.mockClear();
});

describe("manager entry", () => {
  it("changes nothing and requests nothing off a published build", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("origin", "http://localhost:6006");
    vi.stubGlobal("location", { pathname: "/" });
    await import("./manager.ts");
    expect(setConfig).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sets the label renderer on a published build and reads the status with the session cookie", async () => {
    const fetchSpy = vi.fn(async () => await Promise.resolve(new Response("", { status: 404 })));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("origin", "https://shelf.example");
    vi.stubGlobal("location", { pathname: "/projects/gate/storybook/build/b1/" });
    await import("./manager.ts");
    expect(setConfig).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    expect(fetchSpy).toHaveBeenCalledWith("/api/v1/health", { credentials: "same-origin" });
  });
});
