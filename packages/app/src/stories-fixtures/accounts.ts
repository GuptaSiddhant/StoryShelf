/** Story-only signed-in accounts (fixed ids, example.test addresses, never a real domain). */
import type { ProjectMember } from "@storyshelf/core/schema";
import type { AuthUser } from "@storyshelf/core/types";
import { PROJECT_ID } from "./dataset.ts";
import { STORY_NOW } from "./time.ts";

/** A read-only shared demo account (#1274): signs in, signs out and reads, never writes. */
export const SHARED_READ_ONLY_ACCOUNT: AuthUser = {
  id: "01JD000000000000000000USRDEMO",
  email: "demo@example.test",
  name: "Demo",
  role: "member",
  readOnly: true,
};

/**
 * The read-only account's one grant, as on the Fly demo (#1325): a project `viewer` of
 * "Design system". A site `member` sees only the projects it has a role on, so without this row
 * the builds page would answer not found.
 */
export const SHARED_READ_ONLY_MEMBERSHIP: ProjectMember = {
  id: "01JD000000000000000000MBRDEMO",
  projectId: PROJECT_ID,
  userId: SHARED_READ_ONLY_ACCOUNT.id,
  role: "viewer",
  source: "manual",
  createdAt: STORY_NOW,
};
