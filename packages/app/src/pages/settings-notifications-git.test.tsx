import type { Project } from "@storyshelf/core/schema";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithStore, type Store } from "../store.ts";
import { CreateGitChannelCard } from "./settings-notifications-git.tsx";

const project = { slug: "docs" } as Project;
const providers = [{ kind: "github", name: "GitHub", delivery: "state" }] as never;
const store = { sessionId: "s", config: { secret: "test-secret" } } as unknown as Store;

async function render(): Promise<string> {
  const app = new Hono();
  app.get("/", async (c) => {
    return await runWithStore(
      store,
      async () =>
        await c.html(
          <body>
            <CreateGitChannelCard project={project} providers={providers} />
          </body>,
        ),
    );
  });
  return await (await app.request("/")).text();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CreateGitChannelCard", () => {
  it("names the statuses the prefix creates", async () => {
    expect(await render()).toContain("&lt;prefix&gt;/storybook");
  });

  it("says state is delivered inline on a host with no job consumer", async () => {
    vi.stubEnv("VERCEL", "1");
    expect(await render()).toContain("Statuses are delivered inline");
  });

  it("stays quiet on a long-running host", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NETLIFY", "");
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "");
    expect(await render()).not.toContain("delivered inline");
  });
});
