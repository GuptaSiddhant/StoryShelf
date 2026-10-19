/** Capture fingerprint: everything that changes pixels without a code change (ADR 0031 phase 4). */
import type { CaptureEnvironment } from "../adapters/capture-runner.ts";
import { sha256 } from "../utils/hash.ts";
import type { Viewport } from "./adapter.ts";
import { SIZING_DEFAULTS } from "./sizing.ts";

/** The components behind a snapshot's `infraHash`, kept so a mismatch can say what changed. */
export interface Fingerprint {
  engine: string;
  browserVersion: string | null;
  platform: string | null;
  deviceScaleFactor: number | null;
  fontsHash: string | null;
  viewport: { width: number; height: number };
  sizing: typeof SIZING_DEFAULTS;
}

/** Build the fingerprint of one capture. Missing environment fields stay `null` (runner did not report them). */
export function buildFingerprint(
  engine: string,
  viewport: Viewport,
  environment: CaptureEnvironment | undefined,
): Fingerprint {
  return {
    engine,
    browserVersion: environment?.browserVersion ?? null,
    platform: environment?.platform ?? null,
    deviceScaleFactor: environment?.deviceScaleFactor ?? null,
    fontsHash: environment?.fontsHash ?? null,
    viewport: { width: viewport.width, height: viewport.height },
    sizing: SIZING_DEFAULTS,
  };
}

/** Stable hash of a fingerprint: the value stored as `infraHash`. */
export function fingerprintHash(fingerprint: Fingerprint): string {
  return sha256(
    JSON.stringify([
      fingerprint.engine,
      fingerprint.browserVersion,
      fingerprint.platform,
      fingerprint.deviceScaleFactor,
      fingerprint.fontsHash,
      fingerprint.viewport.width,
      fingerprint.viewport.height,
      fingerprint.sizing,
    ]),
  );
}

/** Names of the components that differ; `["unknown"]` when the earlier fingerprint was not recorded. */
export function changedFields(from: Fingerprint | null, to: Fingerprint): string[] {
  if (!from) {
    return ["unknown"];
  }
  const scalars = [
    "engine",
    "browserVersion",
    "platform",
    "deviceScaleFactor",
    "fontsHash",
  ] as const;
  return [
    ...scalars.filter((key) => from[key] !== to[key]),
    ...(sameViewport(from, to) ? [] : ["viewport"]),
    ...(JSON.stringify(from.sizing) === JSON.stringify(to.sizing) ? [] : ["sizing"]),
  ];
}

function sameViewport(from: Fingerprint, to: Fingerprint): boolean {
  return from.viewport.width === to.viewport.width && from.viewport.height === to.viewport.height;
}

/** Parse a stored fingerprint; null for a missing or malformed value. */
export function parseFingerprint(raw: string | null | undefined): Fingerprint | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<Fingerprint>;
    return typeof value.engine === "string" && value.viewport ? (value as Fingerprint) : null;
  } catch {
    return null;
  }
}

/** What a migrated snapshot records: which components changed, and the before and after. */
export interface EnvironmentChange {
  changed: string[];
  from: Fingerprint | null;
  to: Fingerprint;
}
