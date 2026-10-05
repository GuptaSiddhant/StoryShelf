/** A CI token row (hash only; the secret itself is never stored). */
export interface Token {
  id: string;
  projectId: string;
  name: string;
  hash: string;
  /** Owning user, or null for legacy pre-binding tokens (resolved as viewer). */
  userId: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}
