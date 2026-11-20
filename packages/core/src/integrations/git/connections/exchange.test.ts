import { afterEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "../test-fetch.ts";
import { TEST_PRIVATE_KEY } from "../test-key.ts";
import { exchangeManifestCode } from "./exchange.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const CONVERSION = {
  id: 123,
  slug: "storyshelf-acme",
  node_id: "A_1",
  name: "StoryShelf (acme)",
  owner: { login: "acme" },
  html_url: "https://github.com/apps/storyshelf-acme",
  pem: TEST_PRIVATE_KEY,
  webhook_secret: "whsec-should-be-dropped",
  client_id: "Iv1.dropped",
  client_secret: "client-secret-dropped",
};

describe("exchangeManifestCode", () => {
  it("keeps the App id and key, dropping the webhook and client secrets", async () => {
    const calls = stubFetch(() => Response.json(CONVERSION, { status: 201 }));
    const app = await exchangeManifestCode("code_abc-1");
    expect(app).toEqual({
      appId: "123",
      slug: "storyshelf-acme",
      name: "StoryShelf (acme)",
      owner: "acme",
      htmlUrl: "https://github.com/apps/storyshelf-acme",
      privateKey: TEST_PRIVATE_KEY,
    });
    expect(JSON.stringify(app)).not.toMatch(/dropped/u);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.github.com/app-manifests/code_abc-1/conversions");
    expect(calls[0]?.init.method).toBe("POST");
    expect(new Headers(calls[0]?.init.headers).has("authorization")).toBe(false);
  });

  it("uses a GitHub Enterprise Server API base", async () => {
    const calls = stubFetch(() => Response.json(CONVERSION, { status: 201 }));
    await exchangeManifestCode("c", "https://ghes.example.com/api/v3");
    expect(calls[0]?.url).toBe("https://ghes.example.com/api/v3/app-manifests/c/conversions");
  });

  it("refuses a code that could change the path, without a request", async () => {
    const calls = stubFetch(() => Response.json(CONVERSION));
    await expect(exchangeManifestCode("../app")).rejects.toThrow(/manifest code/u);
    expect(calls).toHaveLength(0);
  });

  it("reports a refusal by status only, tried once (the code is single-use)", async () => {
    const calls = stubFetch(() => new Response("code expired: code_xyz", { status: 404 }));
    const error = await exchangeManifestCode("code_xyz").catch((error_: unknown) => error_);
    expect(String(error)).toBe("Error: GitHub did not exchange the manifest code (HTTP 404)");
    expect(calls).toHaveLength(1);
  });

  it("refuses an answer without an App", async () => {
    stubFetch(() => Response.json({ id: 1 }, { status: 201 }));
    await expect(exchangeManifestCode("c")).rejects.toThrow(/without an App/u);
  });
});
