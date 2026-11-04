/** Data behind the review section of the build page (ADR 0013): verdicts, changeset and comments. */
import { publishingOf, publishingOfBuild, type Catalog } from "@storyshelf/core/capture";
import {
  changesetOf,
  CommentModel,
  SnapshotModel,
  UserModel,
  type BuildChangeset,
} from "@storyshelf/core/models";
import type { Build, Comment, Project } from "@storyshelf/core/schema";
import { getStore } from "../store.ts";
import { reviewStateOf, type ReviewState } from "./build-reviews.handlers.ts";
import { isBuildAuthor } from "./comment-triage.ts";
import { currentProjectRole } from "./helpers.ts";

/** What the viewer may do in review. */
export interface ReviewCapabilities {
  /** Write build, story and snapshot comments (developer and above). */
  canComment: boolean;
  /** Give a verdict (approver and admin). */
  canVerdict: boolean;
}

/** Everything the review cards render. */
export interface ReviewSectionData extends ReviewCapabilities {
  project: Project;
  build: Build;
  /** The verdicts and what they make of the build. */
  state: ReviewState;
  changeset: BuildChangeset;
  /** First story of each story file in the build, to link a component to its published story. */
  firstStory: ReadonlyMap<string, string>;
  /** Build and story comments (snapshot comments belong to the diff view). */
  comments: Comment[];
  /** Display names of the users behind verdicts and comments, by user id. */
  names: ReadonlyMap<string, string>;
  /** Change requests of the build, on the build, a story or a snapshot (ADR 0013), newest first. */
  changeRequests: Comment[];
  /** Label of each snapshot a change request is anchored to ("Button / Primary"), by snapshot id. */
  snapshotLabels: ReadonlyMap<string, string>;
  /** Whether the viewer may resolve and reopen comments: developers and above, and the build's author. */
  canTriage: boolean;
  /** Whether the snapshot rollup decides the build, so the verdict is a sign-off only. */
  testing: boolean;
  /** Whether the build's Storybook is published; a verdict waits for `success` (ADR 0013). */
  publishing: Awaited<ReturnType<typeof publishingOfBuild>>;
}

/** Whether review is on for the project (a row without the column counts as on). */
export function reviewIsOn(project: Pick<Project, "reviewEnabled">): boolean {
  return project.reviewEnabled !== false;
}

/** The viewer's review rights: everything with auth off, else by their role on the project. */
export async function reviewCapabilities(project: Project): Promise<ReviewCapabilities> {
  if (!getStore().authEnabled) {
    return { canComment: true, canVerdict: true };
  }
  const role = await currentProjectRole(project.id);
  return {
    canComment: role === "developer" || role === "approver" || role === "admin",
    canVerdict: role === "approver" || role === "admin",
  };
}

/** The review section of a build; null when the project has review off. */
export async function loadReviewSection(
  project: Project,
  build: Build,
  catalog: Catalog | null,
): Promise<ReviewSectionData | null> {
  if (!reviewIsOn(project)) {
    return null;
  }
  const { db, testing } = getStore();
  const [state, changeset, comments, capabilities, publishing] = await Promise.all([
    reviewStateOf(project, build),
    changesetOf(db, project, build),
    new CommentModel(db).listByBuild(build.id),
    reviewCapabilities(project),
    publishingOrPending(build),
  ]);
  const shown = comments.filter((comment) => comment.snapshotId === null);
  const changeRequests = comments
    .filter((comment) => comment.kind === "change_request")
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    project,
    build,
    state,
    changeset,
    firstStory: firstStoryOf(catalog),
    comments: shown,
    names: await namesOf([
      ...state.latest.map((review) => review.userId),
      ...[...shown, ...changeRequests].flatMap((item) => [item.userId, item.resolvedBy]),
    ]),
    changeRequests,
    snapshotLabels: await snapshotLabelsOf(changeRequests),
    canTriage: capabilities.canComment || isBuildAuthor(build),
    testing,
    publishing,
    ...capabilities,
  };
}

/** "Title / Name" of the snapshots change requests are anchored to. */
async function snapshotLabelsOf(requests: readonly Comment[]): Promise<Map<string, string>> {
  const model = new SnapshotModel(getStore().db);
  const ids = [...new Set(requests.flatMap((item) => (item.snapshotId ? [item.snapshotId] : [])))];
  const found = await Promise.all(ids.map(async (id) => await model.get(id)));
  return new Map(
    found.flatMap((snapshot) =>
      snapshot ? [[snapshot.id, `${snapshot.storyTitle} / ${snapshot.storyName}`] as const] : [],
    ),
  );
}

/** How publishing stands; a storage probe that fails reads as the storage-independent state. */
async function publishingOrPending(build: Build): Promise<ReviewSectionData["publishing"]> {
  try {
    return await publishingOfBuild({ db: getStore().db, storage: getStore().storage }, build);
  } catch {
    // The storage-independent reading: no storage to probe and no job lookup to repeat.
    return await publishingOf(undefined, build, { publishJobOpen: true });
  }
}

/** Display names of the given users; ids that no longer resolve show as the id. */
export async function namesOf(userIds: readonly (string | null)[]): Promise<Map<string, string>> {
  const users = new UserModel(getStore().db);
  const ids = [...new Set(userIds.filter((id): id is string => id !== null))];
  const found = await Promise.all(ids.map(async (id) => [id, await users.get(id)] as const));
  return new Map(found.map(([id, user]) => [id, user?.name ?? user?.email ?? id]));
}

/** Story file -> id of its first story. */
function firstStoryOf(catalog: Catalog | null): Map<string, string> {
  const first = new Map<string, string>();
  for (const entry of catalog?.entries ?? []) {
    if (entry.type === "story" && !first.has(entry.importPath)) {
      first.set(entry.importPath, entry.id);
    }
  }
  return first;
}

/** What a component page needs of review: the story comments of the build it shows. */
export interface ComponentReview {
  comments: Comment[];
  canComment: boolean;
  /** Whether the viewer may resolve and reopen comments. */
  canTriage: boolean;
  names: ReadonlyMap<string, string>;
}

/** Story comments of `build` for a component page; null when the project has review off. */
export async function loadComponentReview(
  project: Project,
  build: Build,
): Promise<ComponentReview | null> {
  if (!reviewIsOn(project)) {
    return null;
  }
  const [comments, capabilities] = await Promise.all([
    new CommentModel(getStore().db).listByBuild(build.id),
    reviewCapabilities(project),
  ]);
  const shown = comments.filter((comment) => comment.storyId !== null);
  return {
    comments: shown,
    canComment: capabilities.canComment,
    canTriage: capabilities.canComment || isBuildAuthor(build),
    names: await namesOf(shown.flatMap((item) => [item.userId, item.resolvedBy])),
  };
}
