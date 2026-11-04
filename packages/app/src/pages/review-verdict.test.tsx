import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { ReviewSectionData } from "../routers/review-section.handlers.ts";
import { BUILD_REVIEW, builds, project } from "../stories-fixtures/dataset.ts";
import { VerdictCard } from "./review-verdict.tsx";

// The form's CSRF field reads the request store; this test renders the card on its own.
vi.mock("../shell/csrf-field.tsx", () => ({ csrfField: (): string => "" }));

const build = builds.find((item) => item.id === BUILD_REVIEW);
if (!build) throw new Error("fixture missing: the build under review");

function data(status: string): ReviewSectionData {
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
    canComment: true,
    canVerdict: true,
  } as ReviewSectionData;
}

async function render(status: string): Promise<string> {
  const app = new Hono();
  app.get("/", async (c) => await c.html(<VerdictCard data={data(status)} />));
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
