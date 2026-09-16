/** A webhook subscription row. */
export interface Webhook {
  id: string;
  projectId: string;
  url: string;
  secretEncrypted: string;
  events: string | null;
  createdAt: string;
  updatedAt: string;
}
