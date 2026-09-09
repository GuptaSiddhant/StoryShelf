import type { ProjectRole } from "../types.ts";

/** A project-membership row. */
export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  createdAt: string;
}
