import type { ProjectRole } from "../types.ts";

/** An identity-provider group to project-role mapping row. */
export interface ProjectGroupMapping {
  id: string;
  projectId: string;
  groupName: string;
  role: ProjectRole;
  createdAt: string;
}
