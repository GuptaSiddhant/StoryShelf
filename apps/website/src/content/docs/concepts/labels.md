---
title: Labels
description: Typed build labels for search and stable URLs.
---

Labels identify related builds and link out to external systems. Types are project-defined: a GitHub team defines `pr`, a GitLab team `mr`, and either can add `jira`, `linear`, `figma`, `custom`.

Each type has a `link_template` that turns a value into an external URL:

| Type | Template |
|------|----------|
| `pr` | `https://github.com/{repo}/pull/{value}` |
| `mr` | `https://gitlab.com/{repo}/-/merge_requests/{value}` |
| `jira` | `https://myorg.atlassian.net/browse/{value}` |

## Stable URLs

`/projects/:slug/labels/:key/:value` always shows the latest build bearing that label — a bookmarkable "latest build for this PR/issue" page.
