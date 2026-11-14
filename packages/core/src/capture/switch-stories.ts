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
