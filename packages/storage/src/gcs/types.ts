/** GCS storage adapter options — interface only, no logic. */
import type { Storage } from "@google-cloud/storage";

/** Options for configuring a GCS storage adapter. */
export interface GcsStorageOptions {
  /** GCS bucket name. */
  bucket: string;
  /** Optional key prefix applied to all stored objects. */
  prefix?: string;
  /** Pre-configured GCS client. Defaults to a client built from the other options. */
  client?: Storage;
  /** GCP project ID (defaults to ADC). */
  projectId?: string;
  /** Path to service-account JSON key file. */
  keyFilename?: string;
  /** Service-account credentials object. */
  credentials?: Record<string, unknown>;
  /** Custom API endpoint (e.g. emulator: http://localhost:9090). */
  apiEndpoint?: string;
}
