/** What the service worker's `usage` message answers (ADR 0048, decision 3). */
export interface OfflineKept {
  slug: string;
  name: string;
  commit: string;
  buildId: string;
  /** Bytes this project's files take. */
  size: number;
  syncedAt: string;
  expired: boolean;
}

/** The device's storage state: bytes in use against the cap, and each kept project. */
export interface OfflineUsage {
  usedBytes: number;
  capBytes: number;
  persisted: boolean;
  projects: OfflineKept[];
}

/** Choices offered for the storage cap, in bytes. */
export const CAP_CHOICES: readonly number[] = [
  250 * 1024 * 1024,
  500 * 1024 * 1024,
  1024 * 1024 * 1024,
  2 * 1024 * 1024 * 1024,
];

/** "12.4 MB", "1.5 GB": sizes shown on the device page. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
