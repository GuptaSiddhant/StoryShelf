---
"@storyshelf/core": minor
"@storyshelf/notify-git": minor
---

Added: GitHub, GitLab and git-log notifiers are built into core (ADR 0049).

The git integration moved from `@storyshelf/notify-git` to `@storyshelf/core/integrations`
(`gitHubNotifier`, `gitLabNotifier`, `gitLogNotifier`, `gitNotifiers`, the config schemas) and is
registered by default; it sends nothing until a project configures a git channel. GitLab host
requests are project-set URLs and pass the outbound guard. `@storyshelf/notify-git` is now a
deprecated re-export that stops being published one minor release after this one; import from
`@storyshelf/core/integrations` instead. Behaviour, `statusesForBuild` and the private-key rule are
unchanged.
