/**
 * Git notification providers: `state` channels that make GitHub or GitLab show a build's
 * current commit status and pull-request comment (plus a log provider for tests/dev).
 */
import { gitHubNotifier } from "./github.ts";
import { gitLabNotifier } from "./gitlab.ts";
import { gitLogNotifier } from "./log.ts";

/** GitHub commit status + pull-request comment provider (`github`). */
export { gitHubNotifier };
/** GitLab commit status + merge-request note provider (`gitlab`). */
export { gitLabNotifier };
/** Log-only provider for tests, dev, and unconfigured servers (`git-log`). */
export { gitLogNotifier };

/** All git providers in one list for `ShelfOptions.notifications.notifiers`. */
export const gitNotifiers = [gitHubNotifier, gitLabNotifier, gitLogNotifier];

export { githubConfigSchema } from "./github-config.ts";
export { gitlabConfigSchema } from "./gitlab-config.ts";
export { logConfigSchema } from "./log.ts";
