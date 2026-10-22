/** Which capture targets this instance offers right now, and the checks a settings save runs (ADR 0007). */
import {
  isCaptureTarget,
  parseTarget,
  type CaptureTarget,
  type RunnerTarget,
} from "@storyshelf/core/adapter/capture-runner";
import { MAX_BROWSERS, assertSupportedBrowsers, offeredTargets } from "@storyshelf/core/capture";
import { HTTPException } from "hono/http-exception";
import { getStore, type Store } from "./store.ts";

/**
 * The targets the runner offers, with the ones that need a URL marked `unavailable` while there is
 * no `secret` or public origin. `undefined` when there is no runner or it publishes no list: any
 * target is accepted, as before.
 */
export async function runnerTargets(
  store: Store = getStore(),
): Promise<readonly RunnerTarget[] | undefined> {
  if (store.runner === undefined) {
    return undefined;
  }
  return offeredTargets(store.runner, {
    publicOrigin: await store.publicOrigin?.url(),
    hasSecret: store.config.secret !== undefined,
  });
}

/** Engine label for a target (`Chromium`), plus the remote's name (`Chromium on grid`). */
export function targetLabel(target: CaptureTarget): string {
  const { engine, name } = parseTarget(target);
  const label = engine === "webkit" ? "WebKit" : `${engine[0]?.toUpperCase()}${engine.slice(1)}`;
  return name === undefined ? label : `${label} on ${name}`;
}

/**
 * Refuse, with 400 and the reason, a target list the runner cannot render (not offered, or
 * unavailable), or one that is malformed or too long. Runs when a setting is saved, so a build
 * never fails one by one with an unexplained error.
 */
export async function assertTargetsSelectable(
  targets: readonly string[],
  /** Targets the project already has: saving them again is not a new choice, so they are not refused. */
  current: readonly string[] = [],
): Promise<void> {
  const bad = targets.find((target) => !isCaptureTarget(target));
  if (bad !== undefined) {
    throw new HTTPException(400, { message: `Invalid capture target "${bad}"` });
  }
  if (targets.length > MAX_BROWSERS) {
    throw new HTTPException(400, { message: `Choose at most ${MAX_BROWSERS} browsers` });
  }
  try {
    assertSupportedBrowsers(
      (targets as CaptureTarget[]).filter((target) => !current.includes(target)),
      await runnerTargets(),
    );
  } catch (error) {
    throw new HTTPException(400, { message: error instanceof Error ? error.message : "Refused" });
  }
}
