import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { ReviewSectionData } from "../routers/review-section.handlers.ts";
import { BUILD_REVIEW, builds, project } from "../stories-fixtures/dataset.ts";
import { VerdictCard } from "./review-verdict.tsx";

// The form's CSRF field reads the request store; this test renders the card on its own.
vi.mock("../shell/csrf-field.tsx", () => ({ csrfField: (): string => "" }));

const build = builds.find((item) => item.id === BUILD_REVIEW);
if (!build) throw new Error("fixture missing: the build under review");

function data(status: string, overrides: Partial<ReviewSectionData> = {}): ReviewSectionData {
  return {
    project,
    build: { ...build, status },
    state: { status, approvalsRequired: 1, approvals: 0, latest: [], history: [] },
    changeset: { baseline: null, changeset: { added: [], removed: [], changed: [], unchanged: 0 } },
    firstStory: new Map(),
    comments: [],
    names: new Map(),
    assigned: [],
    changeRequests: [],
    snapshotLabels: new Map(),
    canTriage: true,
    testing: false,
    publishing: "success",
    supersededBy: null,
    canComment: true,
    canVerdict: true,
    ...overrides,
  } as ReviewSectionData;
}

async function render(status: string, overrides: Partial<ReviewSectionData> = {}): Promise<string> {
  const app = new Hono();
  app.get("/", async (c) => await c.html(<VerdictCard data={data(status, overrides)} />));
  return await (await app.request("/")).text();
}

describe("VerdictCard controls", () => {
  it("offers the verdict form while the build is under review", async () => {
    expect(await render("reviewing")).toContain("Approve build");
  });

  it.each(["failed", "cancelled"])("offers no verdict form on a %s build", async (status) => {
    const html = await render(status);
    expect(html).not.toContain("Approve build");
    expect(html).not.toContain("Reject build");
    expect(html).toContain(status);
  });
});

describe("VerdictCard on a build that cannot be reviewed", () => {
  it.each([
    ["failed", "Nothing to review: this build failed."],
    ["cancelled", "Nothing to review: this build was cancelled."],
  ])(
    "says so in one line on a %s build, with no approval counter or rejection text",
    async (status, line) => {
      const html = await render(status);
      expect(html).toContain(line);
      expect(html).not.toContain("approval given");
      expect(html).not.toContain("Any rejection rejects the build");
    },
  );

  it("keeps the approval counter for a build under review", async () => {
    const html = await render("reviewing");
    expect(html).toContain("0 of 1 approval given");
    expect(html).not.toContain("Nothing to review");
  });

  it.each(["failed", "cancelled"])(
    "offers a retry on a %s build where capture is on and the viewer may retry",
    async (status) => {
      const html = await render(status, { testing: true });
      expect(html).toContain("Retry capture");
      expect(html).toContain(`/api/v1/projects/${project.slug}/builds/${build.id}/retry`);
    },
  );

  it("offers no retry without capture, or to a viewer who may not retry", async () => {
    expect(await render("failed")).not.toContain("Retry capture");
    expect(await render("failed", { testing: true, canComment: false })).not.toContain(
      "Retry capture",
    );
  });

  it("offers no retry while the build can still be reviewed", async () => {
    expect(await render("reviewing", { testing: true })).not.toContain("Retry capture");
  });
});

describe("VerdictCard on a superseded build (ADR 0045)", () => {
  const superseded = { ...build, status: "cancelled" as const, supersededByBuildId: "bld_newer" };

  it("names the newer build and links to it", async () => {
    const html = await render("cancelled", {
      build: superseded,
      supersededBy: { id: "bld_newer", gitSha: "5c4d3e2f1a0b" },
    });
    expect(html).toContain("Nothing to review: this build was superseded by");
    expect(html).toContain(`<a href="/projects/${project.slug}/builds/bld_newer">5c4d3e2</a>`);
  });

  it("drops the link once the newer build is gone", async () => {
    const html = await render("cancelled", { build: superseded });
    expect(html).toContain("Nothing to review: this build was superseded.");
    expect(html).not.toContain("bld_newer");
  });

  it("offers no retry, where a hand-cancelled build keeps it", async () => {
    expect(await render("cancelled", { build: superseded, testing: true })).not.toContain(
      "Retry capture",
    );
    expect(await render("cancelled", { testing: true })).toContain("Retry capture");
  });
});
