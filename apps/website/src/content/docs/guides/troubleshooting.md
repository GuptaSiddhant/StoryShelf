---
title: Troubleshooting and FAQ
description: Fixes for the problems people hit most when setting up StoryShelf (uploads, capture, diffs, git statuses, sign-in) and answers to common questions.
---

Start with the doctor. From the folder that holds your Storybook, run:

```sh
npx storyshelf doctor
```

It checks that a Storybook setup is found, that the client config loads, that a server URL, slug and token are set, that the server answers, whether a build output exists, and whether [affected capture](/concepts/affected-capture/) can run. Most setup problems show up there as a `!` or a `✗` with the fix next to it. See [CLI client](/guides/cli/client/#storyshelf-doctor--whoami).

## Uploads from CI

**`--url is required`, `--slug is required` or `--token is required`.** The upload has no server address, project slug or token. Set them with flags, in `.storybook/storyshelf.json` (`url`, `slug`), or in the `STORYSHELF_URL`, `STORYSHELF_SLUG` and `STORYSHELF_TOKEN` environment variables. The token belongs in a CI secret, not in the file. See [Configuration](/guides/config/).

**`401 Unauthorized` or `403 Forbidden`.** `401` means the token is missing or not recognised: check you copied the whole token and that it belongs to this server. `403` means it is valid but its owner cannot upload to this project. A token has the role of the user who created it, so that user needs at least the `developer` role on the project. Run `storyshelf whoami` to confirm which server and project the CLI is using. See [Roles & tokens](/concepts/roles/).

**The upload goes to the wrong project, or the project is not found.** The slug does not match. Each Storybook is one project with one slug, so a monorepo needs one config file per Storybook. See [Monorepo](/guides/config/#monorepo).

**`413` for a large Storybook.** The server refused a zip over its inline size limit and cannot publish it in the background (a serverless host runs no job consumer). The CLI retries by itself file by file, so this usually resolves without action. If it still fails, see the limits in [Published Storybook](/concepts/publishing/#limits).

**"Build output missing".** The upload expected a built Storybook and did not find one. Build it first (`storyshelf build`, or your own `build-storybook`), or let the upload run your build command. See [Build before upload](/guides/config/#build-before-upload).

**The branch or commit is wrong, or everything is rendered every time.** In CI, pass `--sha` and `--branch` explicitly (the examples in [CI setup](/guides/ci/) do), and check out with full history (`fetch-depth: 0` on GitHub Actions): a shallow clone forces full renders because affected capture needs history to diff against.

**Upload works but there are no screenshots.** The instance is probably [hosting only](/concepts/hosting-only/): it publishes the Storybook but runs no capture. The System page and `storyshelf upload` both say so.

## Capture

**A build stays `pending`.** Three common reasons. Review is on and the build is waiting for a verdict: that is expected for a feature-branch build on an instance without capture, and it is accepted or rejected by a reviewer (see [Review](/guides/review/#review-without-screenshots)). The instance has no capture consumer running: open the **Compute jobs** page to see the queue. Or the instance is hosting only.

**A browser shows as unavailable.** Open **System → Capture browsers**: each target is `ready` or `unavailable` with a reason. The Playwright runner never downloads browsers, so install one on the host, matching the pinned `playwright-core` version, for example `npx -y playwright@<version> install --with-deps chromium`. See [@storyshelf/runner-playwright](/packages/runner-playwright/#browsers). A build that cannot launch its browser fails at once instead of retrying.

**Captures time out, or the host runs out of memory.** Each open page costs roughly 100 to 300 MB, and more pages than CPU cores make every page slower. The runner logs a `capture sizing` line with what it detected and chose; if it looks wrong for your host, set the concurrency and timeout explicitly. See [Sizing and cost](/guides/sizing/).

**One story fails and the rest pass.** Open the build's attempt log. A story that crashes the browser fails on its own and the rest of its shard still captures. A story whose `play` function throws fails the build unless it is marked flaky (the `flaky-test` tag). See [Interaction testing](/guides/interaction-testing/). To exclude a story from capture, give it the `skip` tag or `parameters.disableSnapshot`.

**A build is stuck in `capturing`.** If an instance crashes, its jobs are picked up again once their lease runs out (five minutes by default). If a capture is hung, use **Cancel build** on the build page, then retry it there or run `storyshelf retry`.

**Capture refuses to start on a serverless host.** Capture needs a long-running host. Boot refuses it on AWS Lambda and with the Cloudflare D1 database preset, and warns on Vercel and Netlify. Run capture on a container or VM, or leave `testing` unset and use [hosting only](/concepts/hosting-only/).

## Diffs and baselines

**Every story is `new` on a feature branch.** Baselines come from the default branch, so there must be a build of it first. Upload a build from your default branch, and check the project's default branch setting (`git_default_branch`, `main` unless you changed it) matches your repository. See [Baselines & branches](/concepts/baselines/).

**Stories show tiny diffs that nobody changed.** The usual causes are animation, time, random data and fonts. The runner disables animations; for the rest, give a story a `delay`, a `diffThreshold` or `pauseAnimationAtEnd` parameter, make its data deterministic, or set the project's `pixel_threshold` and `max_diff_ratio`. Because capture runs on the server, screenshots do not differ because CI ran on a different machine. See [Modes](/guides/modes/) and [Interaction testing](/guides/interaction-testing/).

**"Baseline changed since this build was captured", or an approval is refused with `409 baseline_changed`.** Another build moved the baseline after this one was captured. **Re-diff** compares the stored screenshots with the baseline that applies now, without rendering; **Retry capture** renders everything again. See [Baselines & branches](/concepts/baselines/).

**An intentional change keeps being flagged.** Approve it on the feature branch: that moves the branch's baseline, so later commits compare with what you accepted. After the merge, the next default-branch build re-baselines.

## Git statuses and notifications

**No commit status or pull-request comment appears.** The most common cause is that no public URL is confirmed, so notifications are paused (the System page says "Notifications are paused until a public URL is set"). Set `PUBLIC_BASE_URL`, or open **System** once and confirm the detected address. See [Public origin](/guides/config/#public-origin). For missing, late or wrong-commit statuses and GitHub App check runs, see [Merge gate troubleshooting](/guides/merge-gate/#troubleshooting).

**Links in notifications point at the wrong host.** The public origin is set to a platform address while a custom domain fronts the app. Set `PUBLIC_BASE_URL` to the address people use.

## Sign-in and access

**Nobody is an admin yet.** With authentication on and an empty database, set `STORYSHELF_ADMIN_TOKEN` on the server: its bearer token grants site-admin API access without a session. See [Roles & tokens](/concepts/roles/#first-admin-bootstrap).

**"Invalid or expired invite".** Invite links are single-use and expire after seven days. Ask an admin to re-invite: that is also how a password is recovered. See [Local accounts](/guides/auth/local/).

**Everyone was signed out, or stored webhooks and tokens stopped working, after a deploy.** `SECRET` changed. It signs sessions and encrypts stored credentials, so a new value signs people out and makes old credentials unreadable. Put the old value in `SECRET_PREVIOUS` and re-encrypt: see [Rotating the server secret](/guides/deployment/secret-rotation/).

**A published Storybook asks for sign-in, or the link 404s.** Only public builds are open to everyone: a build whose branch matches the project's `public_branch_regex`, or that is marked public. Everything else needs at least `viewer` membership. See [Published Storybook](/concepts/publishing/#public-vs-auth-gate).

**A story preview says it cannot be framed.** A private build under sign-in is framed through a signed link, which needs capture enabled and a `secret`. The page offers an **Open** link that uses your session instead.

## FAQ

**Does the server need access to my repository?** No. CI builds the Storybook and uploads it with the commit, branch and author; the server never clones your code. Git hosts are only contacted to post statuses and comments, if you set that up.

**Which Storybook versions work?** Storybook 8, 9 and 10 are covered by the project's own fixtures. See [Capture & viewports](/concepts/capture/).

**Does it work without git, or in a monorepo?** Both. Uploads without git get a synthetic identity and environments act as branches ([Without git](/guides/without-git/)); a monorepo uses one config file and one project per Storybook ([Configuration](/guides/config/#monorepo)).

**Which browsers can it capture?** Chromium by default; Firefox and WebKit if you list them, each with its own baselines, plus real Chrome and [remote browsers](/guides/remote-browsers/).

**Is there a hosted version?** No. StoryShelf is self-hosted, and the [live demo](/guides/demo/) is a seeded instance you can click through. See [Sizing and cost](/guides/sizing/) for what it takes to run.

**Where does my data live?** In the database and storage you choose, on infrastructure you control. See [Security and data handling](/guides/security/).

**How long are builds kept?** Builds and their screenshots are purged after 30 days by default; baselines are kept. See [Retention & purge](/concepts/retention/).

**Something else is wrong.** Check the server logs (structured JSON), the **System** page, and **Compute jobs**; then [open an issue](https://github.com/GuptaSiddhant/StoryShelf/issues) with the output of `storyshelf doctor`.
