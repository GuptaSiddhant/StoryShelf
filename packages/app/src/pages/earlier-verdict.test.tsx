import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { EarlierVerdict } from "../routers/earlier-verdict.ts";
import { builds } from "../stories-fixtures/dataset.ts";
import { reviewComment, reviewData } from "../stories-fixtures/review.ts";
import { DiffComments, earlierVerdictText } from "./build-diff-comments.tsx";
import { changeSummary } from "./project-builds-table.tsx";

vi.mock("../shell/csrf-field.tsx", () => ({ csrfField: (): string => "" }));

const earlier = (over: Partial<EarlierVerdict> = {}): EarlierVerdict => ({
  build: { id: "E1", gitSha: "a1b2c3d4e5", gitBranch: "feature/x" },
  snapshotId: "ES1",
  verdict: "rejected",
  openChangeRequests: [reviewComment("CR", { kind: "change_request", body: "Fix it" })],
  ...over,
});

async function render(note: EarlierVerdict | null, canComment = true): Promise<string> {
  const data = reviewData();
  const app = new Hono();
  app.get("/", (c) =>
    c.html(
      (
        <DiffComments
          project={data.project}
          build={data.build}
          selectedId={data.selectedId ?? ""}
          comments={[]}
          canTriage
          canComment={canComment}
          earlier={note}
        />
      ) as never,
    ),
  );
  return await (await app.request("/")).text();
}

describe("earlier verdict note", () => {
  it("shows the verdict, open change requests and a link to the earlier build", async () => {
    const html = await render(earlier());
    expect(html).toContain("Rejected in a1b2c3d, 1 change request still open.");
    expect(html).toContain(`/builds/E1/diff?snapshot=ES1`);
  });

  it("stays read-only for a role that cannot comment", async () => {
    const html = await render(earlier(), false);
    expect(html).toContain("Rejected in a1b2c3d");
    expect(html).not.toContain("data-approve");
  });

  it("shows no note without an earlier verdict", async () => {
    expect(await render(null)).not.toContain("Earlier build on this branch");
  });

  it("words an approval and open requests with no verdict", () => {
    expect(earlierVerdictText(earlier({ verdict: "approved", openChangeRequests: [] }))).toBe(
      "Approved in a1b2c3d.",
    );
    expect(earlierVerdictText(earlier({ verdict: null }))).toBe(
      "1 change request still open in a1b2c3d.",
    );
  });
});

describe("builds list summary", () => {
  it("counts rejected snapshots", () => {
    const build = {
      ...builds[0],
      changedCount: 0,
      approvedCount: 25,
      rejectedCount: 1,
      snapshotCount: 26,
    };
    expect(changeSummary(build as never)).toBe("25 approved · 1 rejected · 26 snapshots");
    expect(changeSummary({ ...build, rejectedCount: 0 } as never)).toBe(
      "25 approved · 26 snapshots",
    );
  });
});
