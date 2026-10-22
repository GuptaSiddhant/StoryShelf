---
title: Merge gate setup
description: Block PRs and MRs until StoryShelf visual review is approved — required status checks for GitHub and GitLab.
---

StoryShelf posts a **commit status** on the commit it captured, through a **git channel** of the project. The gate only blocks merges once you mark that status as _required_ on your git provider, and that last step is manual: StoryShelf never edits branch protection for you ([ADR 0014](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0014-git-hosts-and-notifications.md)).

## How the gate works

| Build state                            | Status posted |
| -------------------------------------- | ------------- |
| Capture started                        | `pending`     |
| All `new`/`changed` snapshots approved | `success`     |
| Changes rejected, or capture failed    | `failure`     |

The status is named **`<prefix>/testing`**, where `<prefix>` is the git channel's prefix (default `storyshelf`, so `storyshelf/testing`), and links to the build review page. The name has no project slug: a repository that holds several projects gives each channel its own prefix (see [Several projects in one repo](#several-projects-in-one-repo)). Only approvers and admins can accept snapshots, so who can green-light a merge is a matter of [roles](/concepts/roles/).

## 1. Connect the git provider

Do this once per project. See the [CI guide](/guides/ci/#merge-gate) for the short version.

1. Register the git providers on the server, next to any chat or email notifiers: `notifications: { notifiers: [...gitNotifiers] }` from [`@storyshelf/notify-git`](/packages/notify-git/).
2. Open **Project → Settings → Notifications**, find **Add a git channel**, pick the provider, enter `owner` and `repo` (plus `host` for self-hosted GitLab), optionally a status prefix, paste a token, and save.
   - GitHub: a token with `repo:status` scope.
   - GitLab: a token with `api` scope.

The token is stored encrypted with the server `SECRET`, in the channel's secret like a chat webhook URL. It is separate from the CLI project token: the CLI token identifies a build, the status token writes to your repo.

## 2. Upload the PR head commit

The status goes to the SHA you pass to `storyshelf upload --sha`. It has to be the commit the PR or MR is on.

On GitHub, `$GITHUB_SHA` in a `pull_request` workflow is a temporary _merge commit_, not the PR head, so the status would land on a commit the PR never shows. Pass the head SHA instead:

```yaml
- name: Upload to StoryShelf
  run: |
    npx storyshelf upload \
      --url ${{ secrets.STORYSHELF_URL }} \
      --slug ${{ vars.STORYSHELF_SLUG }} \
      --token ${{ secrets.STORYSHELF_TOKEN }} \
      --sha "${{ github.event.pull_request.head.sha || github.sha }}" \
      --branch "${{ github.head_ref || github.ref_name }}"
```

On GitLab, `$CI_COMMIT_SHA` is already the MR head for branch pipelines (see the [CI guide](/guides/ci/#gitlab-ci)).

## 3. Require the status

### GitHub

1. Run the workflow once so GitHub has seen the `<prefix>/testing` status (for example `storyshelf/testing`). GitHub only offers status names it has seen recently.
2. Open **Settings → Branches** (or **Rules → Rulesets**) and add a rule for your default branch.
3. Enable **Require status checks to pass before merging**.
4. Search for `<prefix>/testing` and select it. Add **Require branches to be up to date** if you want the gate re-evaluated after the base moves.
5. Optionally enable **Do not allow bypassing the above settings** so admins can't skip the gate.

### GitLab

1. Make sure the project's merge requests are gated on pipeline results: **Settings → Merge requests → Merge checks → Pipelines must succeed**.
2. Protect the target branch (**Settings → Repository → Protected branches**) so nobody can push around the MR.
3. For approvals on top of the status, add an **approval rule** (**Settings → Merge requests → Merge request approvals**) for the people who own visual review.

StoryShelf posts a GitLab _commit status_ named `<prefix>/testing` on the MR head commit. Whether your "Pipelines must succeed" setting counts it depends on how the status attaches to the pipeline, so confirm the behavior on your instance with the check in step 4 before relying on it.

## Several projects in one repo

One project is one Storybook, and a monorepo can host many. The status name has no project slug, so two channels for the same repository with the same prefix would write to **one** status and the last write would win: one project could turn the other green. Give each project its **own prefix** on its git channel (the same repository and token can be reused): a repo with `web` and `docs` Storybooks uses `storyshelf-web` and `storyshelf-docs`, which post `storyshelf-web/testing` and `storyshelf-docs/testing`. Add **each** one as a required check. A PR that changes only `web` still needs `storyshelf-docs/testing` reported, so upload every project's Storybook in CI even when little changed. [Affected capture](/concepts/affected-capture/) keeps unchanged builds cheap.

Changing a channel's prefix changes the status name. Update the required check when you do, or merges will wait on a status that never arrives. Statuses named after the old `storyshelf/<project-slug>` pattern are no longer posted: after upgrading, add the new name as the required check once per repository.

## 4. Verify the gate

1. Open a PR that changes a visible story (for example a button color).
2. Wait for the upload. The PR should show `<prefix>/testing` as **pending**, then stay unresolved once the build lands in `reviewing`.
3. Confirm the merge button is blocked.
4. Open the build in StoryShelf and approve the snapshots. The status should flip to **success** and unblock the merge.
5. Repeat with **Reject** to confirm a `failure` also blocks.

## Troubleshooting

- **Status never appears.** Check **Project → Settings → Notifications** has a git channel for this project and that its provider is registered on the server. A channel whose last delivery failed shows as **failing** with the error (a revoked token, a missing scope, an unreachable host) until the next build state is delivered successfully; fix the token or the repository and re-run the build or review action. Rotating the server `SECRET` makes stored tokens undecryptable (the server logs `failed to decrypt channel secret`); re-save them.
- **Delivery is best-effort.** A status is written once per build transition, inline, and a failed write is not retried by itself. The next transition (a review decision, a re-run) writes the current state again.
- **Status is on the wrong commit.** The `--sha` was not the PR head (see step 2).
- **Builds with a local identity** (uploads without git, see [Without git](/guides/without-git/)) never post statuses.
- **Capture failed.** A failed capture posts `failure`. Fix the cause and use **Retry** on the build page or `storyshelf retry` to re-run it.

## Related

- [CI setup](/guides/ci/) — upload workflows
- [Review workflow](/guides/review/) — approving and rejecting snapshots
- [Roles & tokens](/concepts/roles/) — who can approve
