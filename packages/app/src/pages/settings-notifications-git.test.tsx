import type { Project } from "@storyshelf/core/schema";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { ProjectGitChannelsNotice } from "./settings-notifications-git.tsx";

const project = { slug: "docs" } as Project;

async function render(channels: number): Promise<string> {
  const app = new Hono();
  app.get(
    "/",
    async (c) =>
      await c.html(
        <body>
          <ProjectGitChannelsNotice project={project} channels={channels} />
        </body>,
      ),
  );
  return await (await app.request("/")).text();
}

describe("ProjectGitChannelsNotice", () => {
  it("warns about the remaining channels and names the release in which they stop", async () => {
    const html = await render(2);
    expect(html).toContain("These 2 git channels stop posting in 0.19.0");
    expect(html).toContain("System › Git");
    expect(html).not.toContain('name="privateKey"');
  });

  it("names one channel in the singular", async () => {
    expect(await render(1)).toContain("This git channel stops posting in 0.19.0");
  });

  it("points a project without channels to its repository links, offering no channel form", async () => {
    const html = await render(0);
    expect(html).toContain('href="/projects/docs/settings/git"');
    expect(html).not.toContain("<form");
  });
});
