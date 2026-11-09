# Changesets

A pull request that changes what a published package does adds a changeset, a small Markdown file
here that says which packages change and what a user should know. Docs, test, CI and typo changes
add none (or carry the `no-release` label).

```sh
nub run changeset <patch|minor|major> [--package <name>…] [--message "<text>"]
```

It writes `.changeset/<three-random-words>.md` for every published package (all packages share one
version, so the choice of package only decides the bump size; `--package` narrows it). Give the entry
with `--message`, or edit the file: CI rejects a file that still holds the placeholder.

The body starts with **one line** `<Kind>: <summary>` of at most 100 characters, then a blank line
and the details (ADR 0043, amendment 2026-11-09). The summary is what the GitHub Release shows; the
details go only into `CHANGELOG.md`. Kind is one of:

- `Breaking`: a user must change something (before 1.0 this is still a `minor` bump);
- `Added`, `Changed`, `Fixed`, `Security`: what a user sees;
- `Internal`: stories, tests, groundwork; counted in the release, not listed.

```md
---
"@storyshelf/app": patch
---

Fixed: the compare page keeps keyboard focus after approving (#812).

Details for CHANGELOG.md: what changed, why, and anything an operator must do.
```

Never edit `CHANGELOG.md` by hand. Merging to `main` publishes a `next` build when changesets are
pending; a stable release is cut by hand (see `docs/adr/0043-release-channels.md`).
