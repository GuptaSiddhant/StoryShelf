import { describe, expect, it } from "vitest";
import type { RunnerTarget } from "../adapters/capture-runner.ts";
import { verifyStorybookToken } from "../utils/storybook-token.ts";
import { storybookUrlSource } from "./storybook-urls.ts";

const targets: RunnerTarget[] = [
  { target: "chromium", reach: "loopback", status: "ready" },
  { target: "chromium@farm", reach: "url", status: "ready" },
];
const runner = { metadata: { name: "r", version: "1", targets } } as never;
const build = { id: "01BUILD", projectId: "01PROJECT" };
const origin = async (): Promise<string | undefined> => await Promise.resolve("https://shelf.test");
/** Resolves to no origin, as while none is configured or stored. */
const noOrigin = async (): Promise<string | undefined> =>
  await Promise.resolve(new Map<string, string>().get("origin"));

function tokenOf(url: string | undefined): string {
  return /\/s\/([^/]+)\/$/u.exec(url ?? "")?.[1] ?? "";
}

describe("storybookUrlSource", () => {
  it("mints the build's root URL for a reach:url target only", async () => {
    const source = storybookUrlSource({ runner, secret: "k", publicOrigin: origin }, build);
    expect(await source("chromium")).toBeUndefined();
    const url = await source("chromium@farm");
    expect(url).toMatch(/^https:\/\/shelf\.test\/s\/[\w-]+\.[\w-]+\/$/u);
    expect(verifyStorybookToken(tokenOf(url), ["k"])).toMatchObject({
      ok: true,
      claims: { projectId: "01PROJECT", buildId: "01BUILD" },
    });
  });

  it("signs with the current key of a rotation pair", async () => {
    const source = storybookUrlSource(
      { runner, secret: { current: "new", previous: "old" }, publicOrigin: origin },
      build,
    );
    const token = tokenOf(await source("chromium@farm"));
    expect(verifyStorybookToken(token, ["new"]).ok).toBe(true);
    expect(verifyStorybookToken(token, ["old"]).ok).toBe(false);
  });

  it("honours the lifetime", async () => {
    const source = storybookUrlSource(
      { runner, secret: "k", publicOrigin: origin, storybookUrlTtl: 600 },
      build,
    );
    const token = tokenOf(await source("chromium@farm"));
    const result = verifyStorybookToken(token, ["k"]);
    expect(result.ok && result.claims.expiresAt - Date.now() / 1000).toBeLessThanOrEqual(600);
  });

  it("makes nothing without a secret or a public origin", async () => {
    const none = storybookUrlSource({ runner, publicOrigin: origin }, build);
    expect(await none("chromium@farm")).toBeUndefined();
    const missing = storybookUrlSource({ runner, secret: "k" }, build);
    expect(await missing("chromium@farm")).toBeUndefined();
    const unresolved = storybookUrlSource({ runner, secret: "k", publicOrigin: noOrigin }, build);
    expect(await unresolved("chromium@farm")).toBeUndefined();
  });

  it("makes nothing for a runner that lists no targets", async () => {
    const bare = { metadata: { name: "r", version: "1" } } as never;
    expect(
      await storybookUrlSource(
        { runner: bare, secret: "k", publicOrigin: origin },
        build,
      )("chromium"),
    ).toBeUndefined();
  });
});
