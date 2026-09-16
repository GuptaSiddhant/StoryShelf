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

## Searching by labels

Use the project builds page filter or `GET /api/v1/projects/:slug/builds?label_key=pr&label_value=42` to find builds by label. Labels are indexed and paginated — a PR with 50 commits remains fast.

## Link templates in the UI

When a link template is configured, the build list and build detail pages render the label value as an external link. Example: a `pr` value `42` becomes a clickable `https://github.com/acme/app/pull/42` badge next to the build SHA.

## Stable URLs

`/projects/:slug/labels/:key/:value` always shows the latest build bearing that label — a bookmarkable "latest build for this PR/issue" page. Share it in PR comments or Jira tickets so reviewers jump to the freshest diff without hunting build IDs.

## Configuring link templates

Add label types in project settings (Settings → Labels) or via `PATCH /api/v1/projects/:slug/settings`:

```json
{ "labelTypes": [{ "key": "pr", "link_template": "https://github.com/{repo}/pull/{value}" }] }
```

`{repo}` is replaced with the project's `git_repository`, `{value}` with the label value. Omit `link_template` to keep the label as plain text.
