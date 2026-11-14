/** Whether a build may switch stories inside one loaded page (ADR 0052, decision 2). */

/**
 * The one place the project's `switchStories` is read. The setting is off unless the project turns
 * it on, and `veto: true` (the operator's `testing.switchStories: false`) overrides it for the
 * whole server, so a project cannot opt in against the operator.
 */
export function switchStoriesEnabled(
  project: { switchStories?: boolean | undefined },
  veto: boolean,
): boolean {
  return !veto && project.switchStories === true;
}

/** True when the operator forbids switching: `testing.switchStories` set to `false`. */
export function switchStoriesVetoed(testing: { switchStories?: boolean } | undefined): boolean {
  return testing?.switchStories === false;
}

/**
 * Whether this build's captures may switch stories (ADR 0052, decision 2): the project asks for
 * it, the operator has not vetoed it, and the runner offers it. A project that asked and is
 * refused gets one log line per build saying why.
 */
export function switchStoriesFor(
  project: { switchStories?: boolean | undefined },
  context: {
    vetoed: boolean;
    runner: { metadata: { switchStories?: boolean | undefined } };
    log?: ((message: string, fields: Record<string, unknown>) => void) | undefined;
  },
): boolean {
  if (project.switchStories !== true) return false;
  if (context.vetoed) {
    context.log?.("story switching is on for this project but the operator turned it off", {
      reason: "vetoed",
    });
    return false;
  }
  if (context.runner.metadata.switchStories !== true) {
    context.log?.(
      "story switching is on for this project but the capture runner does not offer it",
      {
        reason: "runner",
      },
    );
    return false;
  }
  return true;
}
