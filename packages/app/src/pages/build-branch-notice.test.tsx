import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { DefaultBranchNotice } from "./build-branch-notice.tsx";

async function html(node: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html((node ?? "") as never));
  return await (await app.request("/")).text();
}

const project = { slug: "web", gitDefaultBranch: "main" };
const notice = async (
  branchVerified: "verified" | "unverified" | "refused" | "unreachable" | null,
  isDefault = false,
  canReview = true,
): Promise<string> =>
  await html(
    DefaultBranchNotice({ project, build: { id: "b1", isDefault, branchVerified }, canReview }),
  );

describe("DefaultBranchNotice", () => {
  it("says the commit is not on the branch and offers a re-check", async () => {
    const text = await notice("refused");
    expect(text).toContain("Commit is not on main");
    expect(text).toContain("nothing was auto-approved");
    expect(text).toContain('hx-post="/api/v1/projects/web/builds/b1/retry"');
    expect(text).toContain("Re-check and capture again");
  });

  it("says the host could not answer and offers a re-check", async () => {
    const text = await notice("unreachable");
    expect(text).toContain("The git host could not confirm main");
    expect(text).toContain("Re-check and capture again");
  });

  it("tells how to resolve an unverified claim that did not count", async () => {
    const text = await notice("unverified");
    expect(text).toContain("Default branch not verified");
    expect(text).toContain("Connect a GitHub or GitLab channel, or turn off verification");
  });

  it("marks an unverified claim the project counts, without a re-check", async () => {
    const text = await notice("unverified", true);
    expect(text).toContain("Default branch not verified");
    expect(text).toContain("verification is off");
    expect(text).not.toContain("retry");
  });

  it("offers no re-check to a viewer who cannot review", async () => {
    expect(await notice("refused", false, false)).not.toContain("retry");
  });

  it("shows nothing for a verified claim or a build that claims nothing", async () => {
    expect(await notice("verified", true)).toBe("");
    expect(await notice(null)).toBe("");
  });
});
