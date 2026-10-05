---
title: Merge gate setup
description: Block PRs and MRs until StoryShelf visual review is approved — required status checks for GitHub and GitLab.
---

StoryShelf posts a **commit status** on the commit it captured. The gate only blocks merges once you mark that status as *required* on your git provider, and that last step is manual: StoryShelf never edits branch protection for you ([ADR 0010](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0010-git-provider-merge-gate.md)).

## How the gate works

| Build state | Status posted |
|---|---|
| Capture started | `pending` |
| All `new`/`changed` snapshots approved | `success` |
| Changes rejected, or capture failed | `failure` |

The status context is **`storyshelf/<project-slug>`** (for example `storyshelf/my-app`) and links to the build review page. Only approvers and admins can accept snapshots, so who can green-light a merge is a matter of [roles](/concepts/roles/).

## 1. Connect the git provider

Do this once per project. See the [CI guide](/guides/ci/#merge-gate) for the short version.

1. Register the provider on the server: `gitHosts: [gitHubHost]` or `[gitLabHost]` ([`@storyshelf/git-github`](/packages/git-github/), [`@storyshelf/git-gitlab`](/packages/git-gitlab/)).
2. Open **Project → Settings → Git status**, pick the provider, enter `owner` and `repo` (plus `host` for self-hosted GitLab), paste a token, and save.
   - GitHub: a token with `repo:status` scope.
   - GitLab: a token with `api` scope.

The token is stored encrypted with the server `SECRET`. It is separate from the CLI project token: the CLI token identifies a build, the status token writes to your repo.

## 2. Upload the PR head commit

The status goes to the SHA you pass to `storyshelf upload --sha`. It has to be the commit the PR or MR is on.

On GitHub, `$GITHUB_SHA` in a `pull_request` workflow is a temporary *merge commit*, not the PR head, so the status would land on a commit the PR never shows. Pass the head SHA instead:

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

1. Run the workflow once so GitHub has seen the `storyshelf/<project-slug>` status. GitHub only offers status names it has seen recently.
2. Open **Settings → Branches** (or **Rules → Rulesets**) and add a rule for your default branch.
3. Enable **Require status checks to pass before merging**.
4. Search for `storyshelf/<project-slug>` and select it. Add **Require branches to be up to date** if you want the gate re-evaluated after the base moves.
5. Optionally enable **Do not allow bypassing the above settings** so admins can't skip the gate.

### GitLab

1. Make sure the project's merge requests are gated on pipeline results: **Settings → Merge requests → Merge checks → Pipelines must succeed**.
2. Protect the target branch (**Settings → Repository → Protected branches**) so nobody can push around the MR.
3. For approvals on top of the status, add an **approval rule** (**Settings → Merge requests → Merge request approvals**) for the people who own visual review.

StoryShelf posts a GitLab *commit status* named `storyshelf/<project-slug>` on the MR head commit. Whether your "Pipelines must succeed" setting counts it depends on how the status attaches to the pipeline, so confirm the behavior on your instance with the check in step 4 before relying on it.

## Several projects in one repo

One project is one Storybook, and a monorepo can host many. Each project gets its **own** context, so a repo with `web` and `docs` Storybooks posts `storyshelf/web` and `storyshelf/docs`. Add **each** one as a required check, and give each project its own Git status config (the same repo and token can be reused). A PR that changes only `web` still needs `storyshelf/docs` reported, so upload every project's Storybook in CI even when little changed. [Affected capture](/concepts/affected-capture/) keeps unchanged builds cheap.

Changing a project's slug changes its context. Update the required check when you rename a project, or merges will wait on a status that never arrives.

## 4. Verify the gate

1. Open a PR that changes a visible story (for example a button color).
2. Wait for the upload. The PR should show `storyshelf/<project-slug>` as **pending**, then stay unresolved once the build lands in `reviewing`.
3. Confirm the merge button is blocked.
4. Open the build in StoryShelf and approve the snapshots. The status should flip to **success** and unblock the merge.
5. Repeat with **Reject** to confirm a `failure` also blocks.

## Troubleshooting

- **Status never appears.** Check **Project → Settings → Git status** exists for this project, the provider is registered on the server, and the server logs show the status post (warnings: `no provider registered for status config`, `invalid status config`, `failed to decrypt status token`). Rotating the server `SECRET` makes stored tokens undecryptable; re-save them.
- **Status is on the wrong commit.** The `--sha` was not the PR head (see step 2).
- **Builds with a local identity** (uploads without git, see [Without git](/guides/without-git/)) never post statuses.
- **Capture failed.** A failed capture posts `failure`. Fix the cause and use **Retry** on the build page or `storyshelf retry` to re-run it.

## Related

- [CI setup](/guides/ci/) — upload workflows
- [Review workflow](/guides/review/) — approving and rejecting snapshots
- [Roles & tokens](/concepts/roles/) — who can approve
