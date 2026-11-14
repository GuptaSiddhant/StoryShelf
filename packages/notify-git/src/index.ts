/**
 * @deprecated The git integration is built into `@storyshelf/core` (ADR 0049). Import it from
 * `@storyshelf/core/integrations`; this package is a thin re-export that stops being published one
 * minor release after this one.
 */
export {
  gitHubNotifier,
  gitLabNotifier,
  gitLogNotifier,
  gitNotifiers,
  githubConfigSchema,
  gitlabConfigSchema,
  logConfigSchema,
} from "@storyshelf/core/integrations";
