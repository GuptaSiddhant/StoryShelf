/** Capture fingerprint: everything that changes pixels without a code change (ADR 0005 phase 4). */
import type { CaptureEnvironment } from "../adapters/capture-runner.ts";
import { sha256 } from "../utils/hash.ts";
import type { Viewport } from "./adapter.ts";
import { SIZING_DEFAULTS } from "./sizing.ts";

/**
 * What this build of StoryShelf measures the environment with (the browser probe). Bump it only
 * together with a probe change, and list in {@link REMEASURED_IN} the components whose measurement
 * changed. A fingerprint stored without it is version 1.
 */
export const MEASUREMENT_VERSION = 1;

/** The components a comparison reads: the environment fields and the screenshot sizing. */
type MeasuredField =
  | "engine"
  | "browserVersion"
  | "platform"
  | "deviceScaleFactor"
  | "fontsHash"
  | "sizing";

/**
 * Components whose measurement changed when a version was introduced, by that version. Version 1
 * is the baseline of the scheme, so nothing is listed yet. Between two versions, a listed
 * component is compared as unknown, never as a mismatch (it must not cause an environment migration).
 */
const REMEASURED_IN: MeasurementHistory = {};

/** Components whose measurement changed, by the version that changed it. Tests pass their own. */
export type MeasurementHistory = Readonly<Record<number, readonly MeasuredField[]>>;

/** The components behind a snapshot's `infraHash`, kept so a mismatch can say what changed. */
export interface Fingerprint {
  /**
   * How the environment components were measured (see {@link MEASUREMENT_VERSION}). Absent means
   * version 1. It is not part of `infraHash`: the baseline's identity must not change when only
   * the measurement does.
   */
  measurementVersion?: number | undefined;
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
    measurementVersion: MEASUREMENT_VERSION,
    engine,
    browserVersion: environment?.browserVersion ?? null,
    platform: environment?.platform ?? null,
    deviceScaleFactor: environment?.deviceScaleFactor ?? null,
    fontsHash: environment?.fontsHash ?? null,
    viewport: { width: viewport.width, height: viewport.height },
    sizing: SIZING_DEFAULTS,
  };
}

/** Stable hash of a fingerprint: the value stored as `infraHash`. `measurementVersion` is left out on purpose. */
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

/** The version a fingerprint was measured with; one stored before versions existed is version 1. */
export function measurementVersionOf(fingerprint: Fingerprint): number {
  return fingerprint.measurementVersion ?? 1;
}

/**
 * Components measured differently in the two fingerprints: those listed for any version between
 * theirs. Empty when the versions match (nothing about a same-version comparison changes).
 */
export function remeasuredFields(
  from: Fingerprint,
  to: Fingerprint,
  history: MeasurementHistory = REMEASURED_IN,
): MeasuredField[] {
  const [low, high] = [measurementVersionOf(from), measurementVersionOf(to)].toSorted(
    (left, right) => left - right,
  );
  const fields = Object.entries(history)
    .filter(([version]) => Number(version) > (low ?? 1) && Number(version) <= (high ?? 1))
    .flatMap(([, listed]) => listed);
  return [...new Set(fields)];
}

/**
 * Names of the environment components that differ; `["unknown"]` when the earlier fingerprint was
 * not recorded. A component one side did not report (`null`: a runner that does not report it, a
 * capture spooled before a browser crash, a failed `fc-list`) is unknown, not changed, and so is a
 * component measured differently in the two measurement versions. Viewport is never a change
 * here: its size comes from story parameters (the PR's own code), so a new size must be reviewed,
 * and it diffs on its own as a dimension change.
 */
export function changedFields(
  from: Fingerprint | null,
  to: Fingerprint,
  history: MeasurementHistory = REMEASURED_IN,
): string[] {
  if (!from) {
    return ["unknown"];
  }
  const remeasured = new Set<string>(remeasuredFields(from, to, history));
  return [
    ...ENVIRONMENT_FIELDS.filter(
      (key) => !remeasured.has(key) && known(from[key]) && known(to[key]) && from[key] !== to[key],
    ),
    ...(remeasured.has("sizing") || JSON.stringify(from.sizing) === JSON.stringify(to.sizing)
      ? []
      : ["sizing"]),
  ];
}

/**
 * Components that could not be compared because their measurement changed between the two
 * fingerprints' versions. The review says the environment is partly unknown; nothing migrates.
 */
export function unknownFields(
  from: Fingerprint | null,
  to: Fingerprint,
  history: MeasurementHistory = REMEASURED_IN,
): string[] {
  return from ? remeasuredFields(from, to, history) : [];
}

function known(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/**
 * The fingerprint to store on a baseline: the capture's, with any component it did not report kept
 * from the baseline's earlier fingerprint, so an unknown component never overwrites a known one.
 */
export function mergeFingerprint(
  earlier: Fingerprint | null,
  now: Fingerprint,
  history: MeasurementHistory = REMEASURED_IN,
): Fingerprint {
  // A value measured under another version is not carried over a changed measurement.
  const stale = new Set<string>(earlier ? remeasuredFields(earlier, now, history) : []);
  const kept = <Key extends "browserVersion" | "platform" | "deviceScaleFactor" | "fontsHash">(
    key: Key,
  ): Fingerprint[Key] => now[key] ?? (stale.has(key) ? null : (earlier?.[key] ?? null));
  return {
    ...now,
    browserVersion: kept("browserVersion"),
    platform: kept("platform"),
    deviceScaleFactor: kept("deviceScaleFactor"),
    fontsHash: kept("fontsHash"),
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
  /** Components not compared because their measurement changed between versions (absent: none). */
  unknown?: string[] | undefined;
  from: Fingerprint | null;
  to: Fingerprint;
}
