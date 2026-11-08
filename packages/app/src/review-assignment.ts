/**
 * Reviewers assigned from component ownership (#465). The project's owner rules are matched
 * against the story files a build added or changed (its changeset); the owners who are still
 * members become the build's assigned reviewers. Assignment is advisory: it decides who is asked,
 * never what counts as an approval.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import {
  assignOwners,
  changesetOf,
  MemberModel,
  readOwnerRules,
  type Changeset,
} from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";

/** A member asked to review a build, and the components of the build they own. */
export interface AssignedReviewer {
  userId: string;
  /** Titles of the changed components that put them here, sorted. */
  components: string[];
}

/** Components shown in "because you own ..." before the rest are counted. */
const NAMED_COMPONENTS = 3;

/** The components a build added or changed, by story file; entries without a file cannot match. */
function titlesByFile(changeset: Changeset): Map<string, string> {
  const changed = [...changeset.added, ...changeset.changed];
  return new Map(
    changed.filter((item) => item.importPath !== "").map((item) => [item.importPath, item.title]),
  );
}

/**
 * The reviewers the owner rules assign to a build, in the order they first appear in the rules.
 * `changeset` saves a second comparison when the caller already has it. Empty when the project has
 * no rules or no changed component matches one.
 */
export async function assignedReviewersOf(
  db: DatabaseAdapter,
  project: Pick<Project, "id" | "gitDefaultBranch" | "componentOwners">,
  build: Build,
  changeset?: Changeset,
): Promise<AssignedReviewer[]> {
  const rules = readOwnerRules(project.componentOwners);
  if (rules.length === 0) {
    return [];
  }
  const { changeset: found } = changeset ? { changeset } : await changesetOf(db, project, build);
  const titles = titlesByFile(found);
  const members = new Set((await new MemberModel(db).list(project.id)).map((m) => m.userId));
  return assignOwners(rules, [...titles.keys()], members).map((owner) => ({
    userId: owner.userId,
    components: [...new Set(owner.paths.flatMap((path) => titles.get(path) ?? []))].toSorted(),
  }));
}

/** "You were asked to review this because you own A, B and C." (three names, then "and N more"). */
export function assignmentReason(components: readonly string[]): string {
  const named = components.slice(0, NAMED_COMPONENTS);
  const rest = components.length - named.length;
  const list =
    rest > 0
      ? `${named.join(", ")} and ${String(rest)} more`
      : named.length > 1
        ? `${named.slice(0, -1).join(", ")} and ${named.at(-1) ?? ""}`
        : (named[0] ?? "");
  return `You were asked to review this because you own ${list}.`;
}
