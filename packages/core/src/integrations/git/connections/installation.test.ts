import { createVerify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bodyOf, stubFetch } from "../test-fetch.ts";
import { TEST_PRIVATE_KEY, TEST_PUBLIC_KEY } from "../test-key.ts";
import { resolveInstallation } from "./installation.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const APP = { appId: "42", privateKey: TEST_PRIVATE_KEY };

function answer(url: string): Response {
  if (url.endsWith("/installation")) {
    return Response.json({ id: 777, account: { login: "acme" } });
  }
  return Response.json(
    {
      token: "ghs_dropped",
      expires_at: "2026-11-20T12:00:00Z",
      repositories: [{ id: 9001, name: "web", full_name: "acme/web" }],
    },
    { status: 201 },
  );
}

function jwtOf(init: RequestInit): string {
  return new Headers(init.headers).get("authorization")?.replace("Bearer ", "") ?? "";
}

describe("resolveInstallation", () => {
  it("asks GitHub with the App's JWT and returns the installation and repository id", async () => {
    const calls = stubFetch(answer);
    const result = await resolveInstallation(APP, "acme", "web");
    expect(result).toEqual({
      covered: true,
      installationId: "777",
      repositoryId: "9001",
      fullName: "acme/web",
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.github.com/repos/acme/web/installation",
      "https://api.github.com/app/installations/777/access_tokens",
    ]);
    expect(bodyOf(calls[1])).toEqual({ repositories: ["web"], permissions: { metadata: "read" } });
    const [header, claims, signature] = jwtOf(calls[0]?.init ?? {}).split(".");
    const verified = createVerify("RSA-SHA256")
      .update(`${header}.${claims}`)
      .verify(TEST_PUBLIC_KEY, Buffer.from(signature ?? "", "base64url"));
    expect(verified).toBe(true);
    expect(JSON.parse(Buffer.from(claims ?? "", "base64url").toString())).toMatchObject({
      iss: "42",
    });
  });

  it("uses a GitHub Enterprise Server API base", async () => {
    const calls = stubFetch(answer);
    await resolveInstallation({ ...APP, apiUrl: "https://ghes.example.com/api/v3" }, "acme", "web");
    expect(calls[0]?.url).toBe("https://ghes.example.com/api/v3/repos/acme/web/installation");
  });

  it("answers not covered when GitHub answers 404", async () => {
    const calls = stubFetch(() => Response.json({ message: "Not Found" }, { status: 404 }));
    await expect(resolveInstallation(APP, "acme", "web")).resolves.toEqual({ covered: false });
    expect(calls).toHaveLength(1);
  });

  it("answers not covered when the token covers no such repository", async () => {
    stubFetch((url) =>
      url.endsWith("/installation")
        ? Response.json({ id: 777 })
        : Response.json({ token: "t", repositories: [] }, { status: 201 }),
    );
    await expect(resolveInstallation(APP, "acme", "web")).resolves.toEqual({ covered: false });
  });

  it("throws on an inconclusive answer instead of reporting not covered", async () => {
    stubFetch(() => new Response("boom", { status: 500 }));
    await expect(resolveInstallation(APP, "acme", "web")).rejects.toThrow(/HTTP 500/u);
    stubFetch(() => new Response("bad jwt", { status: 401 }));
    await expect(resolveInstallation(APP, "acme", "web")).rejects.toThrow(/HTTP 401/u);
    stubFetch(() => Response.json({}));
    await expect(resolveInstallation(APP, "acme", "web")).rejects.toThrow(/installation id/u);
  });

  it("refuses names that could change the path, without a request", async () => {
    const calls = stubFetch(answer);
    await expect(resolveInstallation(APP, "acme", "web/../x")).rejects.toThrow(/repository/u);
    await expect(resolveInstallation(APP, "", "web")).rejects.toThrow(/repository/u);
    expect(calls).toHaveLength(0);
  });
});
