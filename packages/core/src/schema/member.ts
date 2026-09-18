import type { ProjectRole } from "../types.ts";

/** A project-membership row. */
export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  /** Provenance: `manual` grants vs `oidc:<group>` synced grants. */
  source: string;
  createdAt: string;
}
