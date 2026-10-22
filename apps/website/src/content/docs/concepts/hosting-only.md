---
title: Hosting only
description: Run StoryShelf without the testing option to publish and share Storybooks with no capture, compare or baselines.
---

`createShelfApp({ database, storage })` is a complete deployment. Without the `testing` option StoryShelf **hosts Storybooks only**: it takes uploads, publishes them, and serves the library, component and build pages. Nothing renders, diffs or posts a testing status; a git channel still shows the `<prefix>/review` gate (review on) and the informational `<prefix>/storybook` status, linking to the published Storybook, when a build is published (as everywhere, only with a confirmed [public origin](/guides/config/#public-origin); the git channel form is offered in this mode too). Add `testing: { runner, ... }` and the same instance also captures, compares and keeps baselines.

```ts
createShelfApp({ database, storage }); // hosting only
createShelfApp({ database, storage, testing: { runner: createPlaywrightCaptureRunner() } });
```

## What works without `testing`

Uploads (zip, and the file-by-file `/dedup`, `/content`, `/manifest` routes), published Storybooks, projects, tokens, members, labels, webhooks, notifications, design links, and the library, component and build pages ([Published Storybook](/concepts/publishing/)). Auth is unchanged: who may view a Storybook or upload to a project is decided by the auth adapter and the project's access settings, with or without `testing`.

## What is off

Routes for capture, compare and baselines answer `404` with `Testing is not enabled on this instance.`:

- snapshots (list, approve, reject, approve-all, reject-all, re-diff, images and diffs), attempts and their logs, baselines export and import, build retry, and the affected-capture route;
- the build diff page, the compute-jobs page, the project capture, tests and AI settings pages, and the AI insights routes (they read snapshots).

Every route carries a class (`hosting`, `testing`, `review` or `both`) in one table, and a test boots the app without `testing` to check that each `testing` route answers `404` and no `hosting` route does. The navigation hides what is off: the **Jobs** entry and the capture, tests and AI settings tabs.

## Seeing the mode

- **System page.** A notice says testing is off, with the number of stored snapshots it hides.
- **Startup log.** Boot logs `testing is off` and, when the database holds snapshots, a warning with `hiddenSnapshots`.
- **CLI.** `POST /api/v1/projects/:slug/builds` returns `testing: false`, and `storyshelf upload` prints that the Storybook is published but no checks will run (and skips the affected-capture computation).

Existing snapshots are **hidden, not deleted**: they reappear when `testing` is turned back on. A repository that requires the `<prefix>/testing` commit status must drop that requirement before `testing` is turned off.

## Which builds are accepted

A published build on the project's default branch becomes `approved` when publishing finishes, and so does a build on any other branch when the project has review off. With review on (the default) a build on another branch stays `pending` until an approver or admin gives it a build-level verdict; see [Review](/guides/review/#review-without-screenshots). With `testing` on, capture sets the status. See [Published Storybook](/concepts/publishing/).

## Serverless platforms

`testing` needs a long-running process, so Vercel, AWS Lambda, Netlify and Cloudflare Workers host Storybooks only: boot refuses `testing.runner` on AWS Lambda, warns on Vercel and Netlify, and refuses it on the Cloudflare D1 database preset. `STORYSHELF_ALLOW_SERVERLESS=1` overrides the host check. See [Cloud assembly](/guides/deployment/cloud/).
