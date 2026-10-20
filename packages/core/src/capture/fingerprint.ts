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

/** The components whose change is an environment migration. Viewport is not one (see below). */
const ENVIRONMENT_FIELDS = [
  "engine",
  "browserVersion",
  "platform",
  "deviceScaleFactor",
  "fontsHash",
] as const;

/**
 * Names of the environment components that differ; `["unknown"]` when the earlier fingerprint was
 * not recorded. A component one side did not report (`null`: a runner that does not report it, a
 * capture spooled before a browser crash, a failed `fc-list`) is unknown, not changed. Viewport is
 * never a change here: its size comes from story parameters (the PR's own code), so a new size must
 * be reviewed, and it diffs on its own as a dimension change.
 */
export function changedFields(from: Fingerprint | null, to: Fingerprint): string[] {
  if (!from) {
    return ["unknown"];
  }
  return [
    ...ENVIRONMENT_FIELDS.filter(
      (key) => known(from[key]) && known(to[key]) && from[key] !== to[key],
    ),
    ...(JSON.stringify(from.sizing) === JSON.stringify(to.sizing) ? [] : ["sizing"]),
  ];
}

function known(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/**
 * The fingerprint to store on a baseline: the capture's, with any component it did not report kept
 * from the baseline's earlier fingerprint, so an unknown component never overwrites a known one.
 */
export function mergeFingerprint(earlier: Fingerprint | null, now: Fingerprint): Fingerprint {
  return {
    ...now,
    browserVersion: now.browserVersion ?? earlier?.browserVersion ?? null,
    platform: now.platform ?? earlier?.platform ?? null,
    deviceScaleFactor: now.deviceScaleFactor ?? earlier?.deviceScaleFactor ?? null,
    fontsHash: now.fontsHash ?? earlier?.fontsHash ?? null,
  };
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
