# Changesets

A pull request that changes what a published package does adds a changeset, a small Markdown file
here that says which packages change and what a user should know. Docs, test, CI and typo changes
add none (or carry the `no-release` label).

```sh
nubx changeset
```

Pick every package the change touches (all packages share one version, so the choice only decides
the bump size) and write the entry the way the root `CHANGELOG.md` is written: start with a bold
lead (`**Fixed: …**`, `**Added: …**`, `**Changed: …**`, `**Breaking: …**`) and say what a user
sees, with the issue numbers.

Never edit `CHANGELOG.md` by hand. Merging to `main` publishes a `next` build when changesets are
pending; a stable release is cut by hand (see `docs/adr/0043-release-channels.md`).
