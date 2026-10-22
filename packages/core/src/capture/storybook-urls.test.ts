import { describe, expect, it } from "vitest";
import type { RunnerTarget } from "../adapters/capture-runner.ts";
import {
  DEFAULT_STORYBOOK_URL_TTL,
  MAX_STORYBOOK_URL_TTL,
  STORYBOOK_URL_TTL_GRACE,
  verifyStorybookToken,
} from "../utils/storybook-token.ts";
import { PER_CAPTURE_BUDGET_MS } from "../utils/storybook-token.ts";
import { storybookUrlSource } from "./storybook-urls.ts";

const targets: RunnerTarget[] = [
  { target: "chromium", reach: "loopback", status: "ready" },
  { target: "chromium@farm", reach: "url", status: "ready" },
];
const runner = { metadata: { name: "r", version: "1", targets } } as never;
const build = { id: "01BUILD", projectId: "01PROJECT" };
const project = { storybookUrlTtlSeconds: null };
const subject = { build, project };
const origin = async (): Promise<string | undefined> => await Promise.resolve("https://shelf.test");
/** Resolves to no origin, as while none is configured or stored. */
const noOrigin = async (): Promise<string | undefined> =>
  await Promise.resolve(new Map<string, string>().get("origin"));

function tokenOf(url: string | undefined): string {
  return /\/_s\/([^/]+)\/$/u.exec(url ?? "")?.[1] ?? "";
}

describe("storybookUrlSource", () => {
  it("mints the build's root URL for a reach:url target only", async () => {
    const source = storybookUrlSource({ runner, secret: "k", publicOrigin: origin }, subject);
    expect(await source("chromium")).toBeUndefined();
    const url = await source("chromium@farm");
    expect(url).toMatch(/^https:\/\/shelf\.test\/_s\/[\w-]+\.[\w-]+\/$/u);
    expect(verifyStorybookToken(tokenOf(url), "k")).toMatchObject({
      ok: true,
      claims: { projectId: "01PROJECT", buildId: "01BUILD" },
    });
  });

  it("signs with the current key of a rotation pair", async () => {
    const source = storybookUrlSource(
      { runner, secret: { current: "new", previous: "old" }, publicOrigin: origin },
      subject,
    );
    const token = tokenOf(await source("chromium@farm"));
    expect(verifyStorybookToken(token, "new").ok).toBe(true);
    expect(verifyStorybookToken(token, "old").ok).toBe(false);
  });

  it("derives the lifetime from the pass budget, between the floor and the ceiling", async () => {
    const source = storybookUrlSource({ runner, secret: "k", publicOrigin: origin }, subject);
    const lifetime = async (budgetMs?: number): Promise<number> => {
      const result = verifyStorybookToken(
        tokenOf(await source("chromium@farm", { budgetMs })),
        "k",
      );
      return result.ok ? Math.round(result.claims.expiresAt - Date.now() / 1000) : -1;
    };
    expect(await lifetime()).toBeCloseTo(DEFAULT_STORYBOOK_URL_TTL, -1);
    expect(await lifetime(15 * 60_000)).toBeCloseTo(DEFAULT_STORYBOOK_URL_TTL, -1);
    // 1200 captures at 15 s each = 5 hours of budget, plus the grace.
    expect(await lifetime(1200 * PER_CAPTURE_BUDGET_MS)).toBeCloseTo(
      18_000 + STORYBOOK_URL_TTL_GRACE,
      -1,
    );
    expect(await lifetime(1e9)).toBeCloseTo(MAX_STORYBOOK_URL_TTL, -1);
  });

  it("uses the project's override instead of the derived lifetime", async () => {
    const source = storybookUrlSource(
      { runner, secret: "k", publicOrigin: origin },
      { build, project: { storybookUrlTtlSeconds: 600 } },
    );
    const result = verifyStorybookToken(
      tokenOf(await source("chromium@farm", { budgetMs: 1e9 })),
      "k",
    );
    expect(result.ok && result.claims.expiresAt - Date.now() / 1000).toBeLessThanOrEqual(600);
    expect(result.ok && result.claims.expiresAt - Date.now() / 1000).toBeGreaterThan(590);
  });

  it("makes nothing without a secret or a public origin", async () => {
    const none = storybookUrlSource({ runner, publicOrigin: origin }, subject);
    expect(await none("chromium@farm")).toBeUndefined();
    const missing = storybookUrlSource({ runner, secret: "k" }, subject);
    expect(await missing("chromium@farm")).toBeUndefined();
    const unresolved = storybookUrlSource({ runner, secret: "k", publicOrigin: noOrigin }, subject);
    expect(await unresolved("chromium@farm")).toBeUndefined();
  });

  it("makes nothing for a runner that lists no targets", async () => {
    const bare = { metadata: { name: "r", version: "1" } } as never;
    expect(
      await storybookUrlSource(
        { runner: bare, secret: "k", publicOrigin: origin },
        subject,
      )("chromium"),
    ).toBeUndefined();
  });
});

describe("storybookUrlSource lifetime", () => {
  const offered = {
    metadata: {
      targets: [
        { target: "chromium@remote", reach: "url" },
        { target: "chromium", reach: "local" },
      ],
    },
  } as never;
  const source = storybookUrlSource(
    { runner: offered, secret: "s" },
    { build: { id: "b", projectId: "p" }, project: { storybookUrlTtlSeconds: 7200 } },
  );

  it("reports the lifetime a pass of a budget would get for a signed-URL target", () => {
    expect(source.ttlSeconds?.("chromium@remote", 1000)).toBe(7200);
  });

  it("reports none for a target that needs no signed URL, so it is never sliced", () => {
    expect(source.ttlSeconds?.("chromium", 1000)).toBeUndefined();
  });
});
