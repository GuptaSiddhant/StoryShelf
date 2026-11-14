import { afterEach, describe, expect, it, vi } from "vitest";
import { createFigmaClient } from "./api.ts";
import { respond, URL_NODE } from "./fixtures.ts";
import { createFigmaDesign } from "./index.ts";
import { createFigmaOAuth, figmaOAuthFromEnv } from "./oauth.ts";
import { parseFigmaUrl } from "./url.ts";

afterEach(() => vi.restoreAllMocks());

const OAUTH = { clientId: "client-1", clientSecret: "secret-1" };
/** URL and string body of the first fetch call. */
function firstCall(spy: ReturnType<typeof respond>): {
  url: string;
  init: RequestInit;
  body: string;
} {
  const [input, init = {}] = spy.mock.calls[0] ?? [];
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : "";
  return { url, init, body: typeof init.body === "string" ? init.body : "" };
}

const BASIC = `Basic ${Buffer.from("client-1:secret-1").toString("base64")}`;

describe("createFigmaOAuth", () => {
  it("builds the consent URL with read-only scope and the caller's state", () => {
    const url = new URL(
      createFigmaOAuth(OAUTH).authorizeUrl({ state: "s.1", redirectUri: "https://ss.test/cb" }),
    );
    expect(`${url.origin}${url.pathname}`).toBe("https://www.figma.com/oauth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-1",
      redirect_uri: "https://ss.test/cb",
      scope: "file_content:read",
      state: "s.1",
      response_type: "code",
    });
  });

  it("exchanges a code with basic auth and a form body", async () => {
    const spy = respond(200, { access_token: "at", refresh_token: "rt", expires_in: 3600 });
    const tokens = await createFigmaOAuth(OAUTH).exchangeCode({
      code: "c1",
      redirectUri: "https://ss.test/cb",
    });
    const { url, init, body } = firstCall(spy);
    expect(url).toBe("https://api.figma.com/v1/oauth/token");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe(BASIC);
    expect(new Headers(init.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(body))).toEqual({
      redirect_uri: "https://ss.test/cb",
      code: "c1",
      grant_type: "authorization_code",
    });
    expect(tokens).toMatchObject({ accessToken: "at", refreshToken: "rt" });
    expect(Date.parse(tokens.expiresAt ?? "") - Date.now()).toBeGreaterThan(3_500_000);
  });

  it("refreshes without a refresh token in the answer and defaults the lifetime to 90 days", async () => {
    const spy = respond(200, { access_token: "at2" });
    const tokens = await createFigmaOAuth(OAUTH).refresh({ refreshToken: "rt" });
    const { url, body } = firstCall(spy);
    expect(url).toBe("https://api.figma.com/v1/oauth/refresh");
    expect(body).toBe("refresh_token=rt");
    expect(tokens.refreshToken).toBeNull();
    expect(Date.parse(tokens.expiresAt ?? "") - Date.now()).toBeGreaterThan(89 * 86_400_000);
  });

  it("rejects when Figma refuses the code", async () => {
    respond(400, { error: "invalid_grant" });
    await expect(
      createFigmaOAuth(OAUTH).exchangeCode({ code: "x", redirectUri: "https://ss.test/cb" }),
    ).rejects.toThrow();
  });
});

describe("Figma provider OAuth wiring", () => {
  it("exposes oauth only when an app is configured", () => {
    expect(createFigmaDesign().oauth).toBeUndefined();
    expect(createFigmaDesign({ oauth: OAUTH }).oauth).toBeDefined();
  });

  it("authenticates OAuth credentials with a bearer header and tokens with X-Figma-Token", async () => {
    const ref = parseFigmaUrl(URL_NODE)!;
    const spy = respond(200, { nodes: {} });
    await createFigmaClient("oauth-at", "oauth").fetchMetas(ref.fileKey, [ref]);
    await createFigmaClient("figd_pat").fetchMetas(ref.fileKey, [ref]);
    const first = new Headers(spy.mock.calls[0]?.[1]?.headers);
    const second = new Headers(spy.mock.calls[1]?.[1]?.headers);
    expect(first.get("authorization")).toBe("Bearer oauth-at");
    expect(first.get("x-figma-token")).toBeNull();
    expect(second.get("x-figma-token")).toBe("figd_pat");
    expect(second.get("authorization")).toBeNull();
  });
});

describe("figmaOAuthFromEnv", () => {
  it("needs both the client id and secret", () => {
    expect(figmaOAuthFromEnv({})).toBeUndefined();
    expect(figmaOAuthFromEnv({ FIGMA_CLIENT_ID: "a" })).toBeUndefined();
    expect(figmaOAuthFromEnv({ FIGMA_CLIENT_ID: "a", FIGMA_CLIENT_SECRET: "b" })).toEqual({
      clientId: "a",
      clientSecret: "b",
    });
  });
});
