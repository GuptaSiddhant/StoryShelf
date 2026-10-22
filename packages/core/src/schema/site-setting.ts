/**
 * Row type of `site_settings`: a small key-value table for facts the app learns while running and
 * must share between instances (ADR 0007, decision 6: the public origin an admin's browser reported).
 */

/** One site-wide setting; `id` is the setting's key. */
export interface SiteSetting {
  /** Setting key (`public_origin`). */
  id: string;
  /** Value, as text (JSON for structured settings). */
  value: string;
  /** User that last wrote it, when a person did. */
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
