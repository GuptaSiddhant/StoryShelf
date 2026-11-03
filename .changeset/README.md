# Changesets

A pull request that changes what a published package does adds a changeset, a small Markdown file
here that says which packages change and what a user should know. Docs, test, CI and typo changes
add none (or carry the `no-release` label).

```sh
nub run changeset <patch|minor|major> [--package <name>…] [--message "<text>"]
```

It writes `.changeset/<three-random-words>.md` for every published package (all packages share one
version, so the choice of package only decides the bump size; `--package` narrows it). Give the entry
with `--message`, or edit the file: CI rejects a file that still holds the placeholder. Write it the
way the root `CHANGELOG.md` is written: start with a bold
lead (`**Fixed: …**`, `**Added: …**`, `**Changed: …**`, `**Breaking: …**`) and say what a user
sees, with the issue numbers.

Never edit `CHANGELOG.md` by hand. Merging to `main` publishes a `next` build when changesets are
pending; a stable release is cut by hand (see `docs/adr/0043-release-channels.md`).
