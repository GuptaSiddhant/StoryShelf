import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
/**
 * The earlier verdict on a story: what the latest earlier build on the same branch decided for
 * the same story, mode and target, so a re-upload's review page shows it (#1459). Read through
 * the existing models; a cancelled or failed earlier build has no verdict and is skipped.
 */
import { BuildModel, CommentModel, SnapshotModel } from "@storyshelf/core/models";
import type { Build, Comment, Project, Snapshot } from "@storyshelf/core/schema";

/** What an earlier build decided for one snapshot. */
export interface EarlierVerdict {
  build: Pick<Build, "id" | "gitSha" | "gitBranch">;
  /** The earlier snapshot, so the link can open it. */
  snapshotId: string;
  /** `approved` or `rejected`; null when the snapshot had no verdict but change requests are open. */
  verdict: "approved" | "rejected" | null;
  /** Change requests on that snapshot (or its story) that are still unresolved. */
  openChangeRequests: Comment[];
}

/** How many earlier builds of the branch are looked through for the story. */
const LOOKBACK = 25;

/** The newest builds of the branch read at all; the query is bounded, not the whole history. */
const BRANCH_WINDOW = 100;

const NO_VERDICT_STATUSES: ReadonlySet<string> = new Set(["failed", "cancelled"]);

/** The same story, mode (viewport) and target (engine) as `selected`. */
function sameCapture(a: Snapshot, b: Snapshot): boolean {
  return (
    a.storyId === b.storyId &&
    a.viewportName === b.viewportName &&
    (a.browser ?? "chromium") === (b.browser ?? "chromium")
  );
}

function openChangeRequests(comments: Comment[], earlier: Snapshot): Comment[] {
  return comments.filter(
    (comment) =>
      comment.kind === "change_request" &&
      !comment.resolved &&
      (comment.snapshotId === null
        ? comment.storyId === earlier.storyId
        : comment.snapshotId === earlier.id),
  );
}

/** What `earlier`'s snapshot `match` decided, or null when it decided nothing and nothing is open. */
async function verdictOf(
  db: DatabaseAdapter,
  earlier: Build,
  match: Snapshot,
): Promise<EarlierVerdict | null> {
  const open = openChangeRequests(await new CommentModel(db).listByBuild(earlier.id), match);
  const verdict = match.status === "approved" || match.status === "rejected" ? match.status : null;
  if (verdict === null && open.length === 0) {
    return null;
  }
  const { id, gitSha, gitBranch } = earlier;
  return {
    build: { id, gitSha, gitBranch },
    snapshotId: match.id,
    verdict,
    openChangeRequests: open,
  };
}

/** The latest earlier build's verdict for `selected`, or null when there is nothing to show. */
export async function loadEarlierVerdict(
  db: DatabaseAdapter,
  project: Project,
  build: Build,
  selected: Snapshot,
): Promise<EarlierVerdict | null> {
  const earlier = (
    await new BuildModel(db).list(project.id, { branch: build.gitBranch, limit: BRANCH_WINDOW })
  )
    .filter(
      (item) =>
        item.id !== build.id &&
        item.createdAt < build.createdAt &&
        !NO_VERDICT_STATUSES.has(item.status),
    )
    .slice(0, LOOKBACK);
  const snapshots = new SnapshotModel(db);
  for (const item of earlier) {
    // oxlint-disable-next-line no-await-in-loop -- newest first; stops at the first build with the story
    const match = (await snapshots.listByBuild(item.id)).find((s) => sameCapture(s, selected));
    if (match !== undefined) {
      // oxlint-disable-next-line no-await-in-loop -- returns at once
      return await verdictOf(db, item, match);
    }
  }
  return null;
}
