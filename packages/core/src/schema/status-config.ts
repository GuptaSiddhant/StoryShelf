/** A project status-config row. */
export interface ProjectStatusConfig {
  id: string;
  projectId: string;
  provider: string;
  config: string;
  tokenEncrypted: string;
  createdAt: string;
  updatedAt: string;
}
