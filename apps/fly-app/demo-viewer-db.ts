/** The demo viewer's steps on the server's real database (`demo-viewer.ts` holds the logic). */
import { acceptInvite, hasPasswordCredential, issueInvite } from "@storyshelf/auth";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { MemberModel, ProjectModel, UserModel } from "@storyshelf/core/models";
import type { DemoViewerDeps } from "./demo-viewer.ts";

/** The real steps, on the server's database. Re-inviting an existing user refreshes it and sets the password. */
export function databaseDeps(db: DatabaseAdapter): DemoViewerDeps {
  return {
    findUserId: async (email) => (await new UserModel(db).getByEmail(email))?.id ?? null,
    createUser: async (email, password) => {
      const invite = await issueInvite(db, { email, name: "Demo viewer", role: "viewer" });
      return (await acceptInvite(db, { ...invite, password })).id;
    },
    hasCredential: async (userId) => await hasPasswordCredential(db, userId),
    projectId: async (slug) => (await new ProjectModel(db).getBySlug(slug))?.id ?? null,
    isMember: async (projectId, userId) =>
      (await new MemberModel(db).get(projectId, userId)) !== null,
    addViewer: async (projectId, userId) => {
      await new MemberModel(db).set(projectId, userId, "viewer");
    },
  };
}
