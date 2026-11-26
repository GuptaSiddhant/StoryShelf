---
"storyshelf": patch
---

Fixed: uploads on a GitHub pull request use the PR head commit and branch

`storyshelf upload` took `GITHUB_SHA` and `GITHUB_REF_NAME`, which on a `pull_request` event are the temporary merge commit and `<n>/merge`, so builds and statuses landed on a commit the PR never shows. The identity now comes from a table of CI providers (GitHub Actions, GitLab CI, Vercel, Netlify, CircleCI, Buildkite, Bitbucket Pipelines, Azure Pipelines, Jenkins), each reading only variables its documentation lists. On GitHub the head commit is read from the event file (`pull_request`, `pull_request_target`, `merge_group`); a push is unchanged. Per field the order is flags, CI provider, local git, then a synthesized identity; the message and author come from `git log` on the resolved commit, then the provider's variables. `storyshelf doctor` and `upload --verbose` list each value with its source.

Also: `SHELF_URL` and `SHELF_SLUG` now take precedence over `.storybook/storyshelf.json` as documented (an empty variable counts as unset); `--token` warns that arguments show in the process list (naming the flag, never the value); a `token` key in `storyshelf.json` is refused with an error naming the key and `SHELF_TOKEN`; and `upload` warns on a shallow clone when affected capture or `--skip-unchanged` would fall back, without failing. Schema: none.
