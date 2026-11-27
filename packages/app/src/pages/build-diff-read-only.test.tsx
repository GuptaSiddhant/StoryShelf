import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { ReviewSectionData } from "../routers/review-section.handlers.ts";
import { BUILD_REVIEW, builds, project } from "../stories-fixtures/dataset.ts";
import { reviewData } from "../stories-fixtures/review.ts";
import { DiffComments } from "./build-diff-comments.tsx";
import { ReviewCanvas } from "./build-diff.tsx";
import { CommentsCard } from "./review-comments.tsx";

// The forms' CSRF field reads the request store; these tests render the pages on their own.
vi.mock("../shell/csrf-field.tsx", () => ({ csrfField: (): string => "" }));

/** The review stage (viewer, action bar and thread) for the fixture build's selected snapshot. */
function canvas(overrides: Parameters<typeof reviewData>[0] = {}): unknown {
  const data = reviewData(overrides);
  const selected = data.snapshots.find((snapshot) => snapshot.id === data.selectedId);
  return <ReviewCanvas {...data} selected={selected} usage={[]} design={[]} />;
}

async function html(node: () => unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html(node() as never));
  return await (await app.request("/")).text();
}

const build = builds.find((item) => item.id === BUILD_REVIEW);
if (!build) throw new Error("fixture missing: the build under review");

function section(overrides: Partial<ReviewSectionData>): ReviewSectionData {
  return {
    project,
    build,
    state: { status: "pending", approvalsRequired: 1, approvals: 0, latest: [], history: [] },
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

describe("review page for a role that cannot review", () => {
  it("a Viewer sees no verdict or comment controls, and one read-only line", async () => {
    const page = await html(() =>
      canvas({ canReview: false, canComment: false, canTriage: false }),
    );
    expect(page).not.toContain("data-approve");
    expect(page).not.toContain("data-reject");
    expect(page).not.toContain('/comments"');
    expect(page).not.toContain("mention-suggest");
    expect(page.match(/is read-only/gu)).toHaveLength(1);
  });

  it("a reviewer still sees them, and no read-only line", async () => {
    const page = await html(() => canvas());
    expect(page).toContain("data-approve");
    expect(page).toContain("data-reject");
    expect(page).toContain("<textarea");
    expect(page).not.toContain("is read-only");
  });

  it("the snapshot thread swaps in with its box unless the role is read-only", async () => {
    const data = reviewData();
    const props = {
      project: data.project,
      build: data.build,
      selectedId: data.selectedId ?? "",
      comments: [],
      canTriage: false,
    };
    expect(await html(() => <DiffComments {...props} />)).toContain("<textarea");
    const readOnly = await html(() => <DiffComments {...props} canComment={false} />);
    expect(readOnly).not.toContain("<textarea");
    expect(readOnly).toContain("is read-only");
  });

  it("the build comments card shows the line instead of the box", async () => {
    expect(await html(() => <CommentsCard data={section({})} />)).toContain("<textarea");
    const readOnly = await html(() => (
      <CommentsCard data={section({ canComment: false, canTriage: false })} />
    ));
    expect(readOnly).not.toContain("<textarea");
    expect(readOnly).toContain("is read-only");
  });
});
