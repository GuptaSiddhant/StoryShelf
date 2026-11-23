/**
 * The Fly demo's one published read-only account (#1275).
 *
 * The password comes from the `SHELF_DEMO_VIEWER_PASSWORD` Fly secret, never from a committed file
 * and never into a log. The user is created through the invite path (`issueInvite` + `acceptInvite`,
 * the same one a person's invite uses) with the site role `member` (a site `viewer` reads every
 * project), then made a project `viewer` of `storyshelf-ui`, its only grant; `SHELF_READ_ONLY_ACCOUNTS`
 * refuses its writes. Every step is idempotent, so the boot and the periodic retry (the project is
 * created by the first upload, which may come after the boot) are safe to repeat.
 */
export const DEMO_VIEWER_EMAIL = "demo@storyshelf.js.org";
export const DEMO_PROJECT_SLUG = "storyshelf-ui";

/** The steps {@link ensureDemoViewer} runs, injectable so the tests need no database. */
export interface DemoViewerDeps {
  findUserId(email: string): Promise<string | null>;
  createUser(email: string, password: string): Promise<string>;
  /** Whether the user can sign in with a password (a failed `createUser` can leave one without). */
  hasCredential(userId: string): Promise<boolean>;
  projectId(slug: string): Promise<string | null>;
  isMember(projectId: string, userId: string): Promise<boolean>;
  addViewer(projectId: string, userId: string): Promise<void>;
  /** Give the user the site role `member` unless it has it; whether it changed. */
  ensureSiteMember(userId: string): Promise<boolean>;
}

/** What a run did, for one log line (no secret in it). */
export interface DemoViewerResult {
  userCreated: boolean;
  memberAdded: boolean;
  /** The user existed without a password and now has one. */
  credentialSet: boolean;
  /** An existing user had another site role (a site `viewer` reads every project) and is now `member`. */
  roleFixed: boolean;
}

/**
 * Create the demo viewer when missing (or give it its password when a failed run left it without), and make it a viewer of `storyshelf-ui` when that project
 * exists. An existing user with another site role is set back to `member`. A no-op without a password.
 */
export async function ensureDemoViewer(
  deps: DemoViewerDeps,
  password: string | undefined,
): Promise<DemoViewerResult> {
  if (!password) {
    return { userCreated: false, memberAdded: false, credentialSet: false, roleFixed: false };
  }
  const existing = await deps.findUserId(DEMO_VIEWER_EMAIL);
  // A user left without a credential by a failed earlier run is completed, never skipped.
  const staged = existing !== null && !(await deps.hasCredential(existing));
  const userId =
    existing === null || staged ? await deps.createUser(DEMO_VIEWER_EMAIL, password) : existing;
  // An account made before the site role was `member` keeps no wider access than its one grant.
  const roleFixed = await deps.ensureSiteMember(userId);
  const projectId = await deps.projectId(DEMO_PROJECT_SLUG);
  const missing = projectId !== null && !(await deps.isMember(projectId, userId));
  if (missing) await deps.addViewer(projectId, userId);
  return { userCreated: existing === null, memberAdded: missing, credentialSet: staged, roleFixed };
}
