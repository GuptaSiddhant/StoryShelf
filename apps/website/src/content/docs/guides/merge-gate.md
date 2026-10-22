---
title: Merge gate setup
description: Block PRs and MRs until StoryShelf visual review is approved — required status checks for GitHub and GitLab.
---

StoryShelf posts a **commit status** on the commit it captured, through a **git channel** of the project. The gate only blocks merges once you mark that status as _required_ on your git provider, and that last step is yours: StoryShelf only changes branch protection when you run [`storyshelf protect --apply`](#let-storyshelf-set-the-rule) with an admin token ([ADR 0014](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0014-git-hosts-and-notifications.md)). On GitHub the same name can also be a **check run** posted by a GitHub App, with one annotation per changed snapshot ([GitHub App checks](#github-app-checks)).

## How the gate works

| Build state (`testing` on)             | `<prefix>/testing` |
| -------------------------------------- | ------------------ |
| Capture started, or review still open  | `pending`          |
| All `new`/`changed` snapshots approved | `success`          |
| Changes rejected, or capture failed    | `failure`          |
| A user cancelled the build             | `cancelled`        |

Without `testing` (a [hosting-only](/concepts/hosting-only/) project) the gate is **`<prefix>/review`**, fed by the build-level verdicts of [Review](/guides/review/#review-without-screenshots):

| Build state (`testing` off, review on)                                | `<prefix>/review` |
| --------------------------------------------------------------------- | ----------------- |
| Waiting for a verdict (default-branch builds are accepted on publish) | `pending`         |
| Approved: the required approvals are present, no latest rejection     | `success`         |
| A reviewer's latest verdict is a rejection, or the build failed       | `failure`         |
| A user cancelled the build                                            | `cancelled`       |

While a build waits for more than one approval, the `pending` description shows the progress, for example `Waiting for approvals: 1 of 2`.

With `testing` on, `<prefix>/testing` stays the only gate and review never adds a second required check. A project with review off has no gate: without `testing` it posts no `<prefix>/testing` and no pending `<prefix>/review`. When review is turned off, builds that were accepted get a final `<prefix>/review` of `success` with the description `Review is off`, so a pull request that was waiting is not left with a stale `pending` status (and a required `<prefix>/review` never waits for a verdict that will not come). The status is shown for every accepted build of a review-off project.

The gating status is named **`<prefix>/testing`**, where `<prefix>` is the git channel's prefix (default `storyshelf`, so `storyshelf/testing`), and links to the build review page. Its description says whether review is still open. StoryShelf also posts `<prefix>/storybook` (the published Storybook, informational), which you should not require. Statuses follow the build's current state and are delivered durably with retries; see [Delivery](/packages/notify-git/#delivery). The name has no project slug: a repository that holds several projects gives each channel its own prefix (see [Several projects in one repo](#several-projects-in-one-repo)). Only approvers and admins can accept snapshots, so who can green-light a merge is a matter of [roles](/concepts/roles/).

> **A public URL is required.** Every status links to the build page, so nothing is posted, and the required check never appears, while the server has no [public origin](/guides/config/#public-origin). Set `PUBLIC_BASE_URL` (or confirm the detected origin on **System**: a detected address is not used until it is confirmed); until then **System** and the project's notification settings show "Notifications are paused until a public URL is set" and no channel is marked as failing.

## 1. Connect the git provider

Do this once per project. See the [CI guide](/guides/ci/#merge-gate) for the short version.

1. Register the git providers on the server, next to any chat or email notifiers: `notifications: { notifiers: [...gitNotifiers] }` from [`@storyshelf/notify-git`](/packages/notify-git/).
2. Open **Project → Settings → Notifications**, find **Add a git channel**, pick the provider, enter `owner` and `repo` (plus `host` for self-hosted GitLab), optionally a status prefix, paste a token, and save.
   - GitHub: a token with `repo:status` scope.
   - GitLab: a token with `api` scope.

The token is stored encrypted with the server `SECRET`, in the channel's secret like a chat webhook URL. It is separate from the CLI project token: the CLI token identifies a build, the status token writes to your repo.

### GitHub App checks

Optional, GitHub only. Instead of a token that writes commit statuses, a **GitHub App** installed on the repository posts **check runs** named `<prefix>/testing`: the run follows the build (`queued`, `in_progress`, then `success`, `failure` or `cancelled`) and lists each changed snapshot as an annotation that links to its review page. There is no personal access token to rotate. See [GitHub check runs](/packages/notify-git/#github-check-runs) for the exact mapping. GitLab keeps commit statuses.

1. Create the App: **Settings → Developer settings → GitHub Apps → New GitHub App** (on your organization for a shared repository). Name it, set any homepage URL, **uncheck Webhook → Active** (StoryShelf polls nothing and receives no webhooks from it) and set the repository permissions:
   - **Checks: Read and write** (the check runs)
   - **Pull requests: Read and write** (the pull-request comment)
   - **Contents: Read-only** (to resolve the commit)
   - **Commit statuses: Read and write** only if you also want a channel in `statuses` mode on the same App (optional)
   - **Administration: Read and write** only if you want the App's installation to be able to run [`storyshelf protect`](#let-storyshelf-set-the-rule) (optional: the helper normally uses your own admin token)
2. Under **Where can this GitHub App be installed?** pick _Only on this account_.
3. Create the App and note its **App ID**. Under **Private keys** choose **Generate a private key** and keep the downloaded `.pem` file.
4. Open **Install App**, install it on the repository (or organization) and copy the **installation ID** from the URL of the installation's settings page (`…/settings/installations/<installation id>`).
5. In **Project → Settings → Notifications → Add a git channel** choose GitHub, set **GitHub mode** to _Check runs (GitHub App)_, enter owner, repository, prefix, **App ID**, **Installation ID** and paste the whole PEM into **App private key**. Leave the token empty. Through the API: `"config": { "owner": "acme", "repo": "widgets", "mode": "checks", "appId": "123456", "installationId": "7654321" }` and the PEM as `"secret"`.

The private key is stored encrypted with the server `SECRET`, is never returned by the API or shown in the UI again, and is removed from logs and error text; to rotate it, add the channel again with a new key and delete the old one. A required check keeps its name, so branch protection (below) is the same in either mode.

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

## Let StoryShelf set the rule

Marking the check required is a manual step that is easy to skip, so the CLI can print it, validate it and, only when you ask, write it:

```sh
# Dry run: prints the steps and compares them with the branch's current rule. Nothing is changed.
GITHUB_TOKEN=<admin token> storyshelf protect --provider github --repo acme/widgets --branch main

# Same checks for a project with its own prefix, or one without testing (the gate is <prefix>/review)
storyshelf protect --provider github --repo acme/widgets --prefix storyshelf-web [--gate review]

# Write the missing part
storyshelf protect --provider github --repo acme/widgets --apply
```

Without a token the command only prints the exact required check names and the manual steps. With one it also reads the branch's rule and exits with a non-zero code when the rule lacks the check, so it can run in CI as a drift check.

- **GitHub** (token with repository administration: `repo` for a classic token, **Administration: write** for a fine-grained one). It reads `…/branches/<branch>/protection/required_status_checks`. With `--apply` it adds only the missing check to a rule that already requires some (existing checks and every other setting stay), or creates a rule on an unprotected branch that requires the check and nothing else. A protected branch that requires no status checks is reported but not changed: add the check by hand. Rulesets (**Rules → Rulesets**) are not read; use the manual steps there.
- **GitLab** (`GITLAB_TOKEN` with `api` scope and the Maintainer role; `--host https://gitlab.example.com` for self-managed). GitLab has no per-status required list: statuses on the MR head commit join its pipeline, so the gate is the project setting **Pipelines must succeed**. The command checks it (and that the branch is protected) and, with `--apply`, turns the setting on. It does not protect the branch for you.

See [`storyshelf protect`](/guides/cli/client/#storyshelf-protect) for every flag.

## Several projects in one repo

One project is one Storybook, and a monorepo can host many. The status name has no project slug, so two channels for the same repository with the same prefix would write to **one** status and the last write would win: one project could turn the other green. Give each project its **own prefix** on its git channel (the same repository and token can be reused): a repo with `web` and `docs` Storybooks uses `storyshelf-web` and `storyshelf-docs`, which post `storyshelf-web/testing` and `storyshelf-docs/testing`. Add **each** one as a required check. A PR that changes only `web` still needs `storyshelf-docs/testing` reported, so upload every project's Storybook in CI even when little changed. [Affected capture](/concepts/affected-capture/) keeps unchanged builds cheap.

Changing a channel's prefix changes the status name. Update the required check when you do, or merges will wait on a status that never arrives.

## 4. Verify the gate

1. Open a PR that changes a visible story (for example a button color).
2. Wait for the upload. The PR should show `<prefix>/testing` as **pending**, then stay unresolved once the build lands in `reviewing`.
3. Confirm the merge button is blocked.
4. Open the build in StoryShelf and approve the snapshots. The status should flip to **success** and unblock the merge.
5. Repeat with **Reject** to confirm a `failure` also blocks.

## Troubleshooting

- **Status never appears.** Check **Project → Settings → Notifications** has a git channel for this project and that its provider is registered on the server. A channel whose last delivery failed shows as **failing** with the error (a revoked token, a missing scope, an unreachable host) until the next build state is delivered successfully; fix the token or the repository and re-run the build or review action. Rotating the server `SECRET` makes stored tokens undecryptable (the server logs `failed to decrypt channel secret`); re-save them.
- **Status is late.** Statuses are delivered by `notify` jobs, so one can lag the build by a queue polling interval, and a refused write is retried with backoff (five attempts in total). A hosting-only instance on a serverless platform delivers inline instead, without retries: the next transition writes the current state again.
- **Check run stays queued or is missing (GitHub App).** The App must be installed on this repository and have **Checks: Read and write**; a refused write shows on the channel as failing with the GitHub error. Check the App ID, the installation ID and that the whole PEM (including the `BEGIN`/`END` lines) was pasted.
- **Status stays pending after a failure.** After the last attempt the channel shows the error and a `sys:notify-failed` alert goes to the site-wide channels; fix the token or repository, then run the build or review action again to deliver the current state.
- **Status is on the wrong commit.** The `--sha` was not the PR head (see step 2).
- **Builds with a local identity** (uploads without git, see [Without git](/guides/without-git/)) never post statuses.
- **Build cancelled.** A cancelled build shows the state `cancelled` with the description `Cancelled`: GitLab's own `canceled` pipeline state, and on GitHub (which has no cancelled commit state) `error`. A required check in that state does not pass, so the pull request stays blocked until you **Retry** the build or push a new commit.
- **Capture failed.** A failed capture posts `failure`. Fix the cause and use **Retry** on the build page or `storyshelf retry` to re-run it.

## Related

- [CI setup](/guides/ci/) — upload workflows
- [Review workflow](/guides/review/) — approving and rejecting snapshots
- [Roles & tokens](/concepts/roles/) — who can approve
