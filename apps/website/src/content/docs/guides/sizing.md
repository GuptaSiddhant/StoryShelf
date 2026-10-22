---
title: Sizing and cost
description: What a StoryShelf server needs, what grows with your Storybook, and how to plan hosts, storage and cost without per-snapshot billing.
---

StoryShelf has no per-snapshot or per-seat fee. What it costs is the infrastructure you run it on: a server that can run a browser, a database and storage. This page explains what drives each of those, so you can pick a starting size and know what to watch.

## Starting points

| You want to…                              | Start with                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Try it, or run it for one small Storybook | One host with **1 vCPU and 2 GB**, local disk, SQLite. The live demo runs on a 1 GB machine that stops when idle. |
| Run it for a team with a few Storybooks   | **2 vCPU and 4 GB**, Postgres or SQLite, local disk or S3. Two pages render at once.                              |
| Capture often, or large Storybooks        | **4 vCPU and 8 GB** (two builds at once, four pages each), Postgres, S3-compatible storage. Add instances later.  |
| Only publish and share Storybooks         | A small container, or a serverless platform: [hosting only](/concepts/hosting-only/) needs no browser.            |

Those sizes are starting points, not limits. StoryShelf reads the CPU and memory the process can actually use (container limits included) and sizes its own concurrency from them, so a bigger host captures faster without changing any setting. See [Sizing memory for capture](/guides/deployment/#sizing-memory-for-capture) for the exact rules and how to override them.

## What uses what

### CPU and memory: the browser

Capture drives Chromium, and that dominates. Each open page costs roughly 100 to 300 MB, so StoryShelf renders a bounded number of pages at once. More pages than CPU cores does not make capture faster: the pages compete for the same cores, load more slowly, and start to time out.

| Host           | Builds at once | Pages at once | Navigation timeout |
| -------------- | -------------- | ------------- | ------------------ |
| 0.5 vCPU, 1 GB | 1              | 1             | 90 s               |
| 1 vCPU, 2 GB   | 1              | 1             | 60 s               |
| 2 vCPU, 4 GB   | 1              | 2             | 30 s               |
| 4 vCPU, 8 GB   | 2              | 4             | 30 s               |

If a build runs out of memory, lower the runner's concurrency first, then add RAM. A server that only publishes Storybooks (no capture) needs none of this.

### Storage: screenshots and Storybooks

- **Screenshots are stored by content.** A screenshot is saved once under the hash of its bytes, and snapshots and baselines point at it. Approving a change repoints the baseline instead of copying it, and a story that renders identically build after build stores nothing new. Storage therefore grows with the screenshots that **change**, not with every build.
- **Uploaded Storybooks are deduplicated too.** Files are stored once by hash, so a build that differs from the last in a few files adds only those files.
- **Old data is removed.** Builds, their screenshots and diff overlays are purged after `purgeTtlDays` (default 30 days); feature-branch baselines are removed after `branchTtlDays` (default 30 days); the default branch's baselines are kept. Screenshots nothing references any more are swept. See [Retention & purge](/concepts/retention/).

To estimate captures per build, multiply the number of stories by the viewports, modes and browsers you capture. A Storybook with 500 stories, two viewports and one browser is 1,000 captures per build; each is one screenshot, compared against its baseline. The compared PNGs are what your storage holds, so measure one real build and multiply by how many branches you expect to keep.

### Database

The database holds metadata (projects, builds, snapshots, comments, users) and the job queue, not images, so it stays small. SQLite on the same host is enough for a single instance. Use Postgres or MySQL when you run more than one instance or want a managed database: instances share the queue through it.

## How long capture takes

Measured on the repository's own Storybook fixtures, one page at a time on Chromium, a story takes roughly 1.2 to 1.3 seconds per viewport, and the accessibility scan (on by default) adds about 0.15 seconds. A build of 1,000 captures is therefore on the order of 20 to 25 minutes at one page at a time, and shorter with more pages. Your stories will differ: heavy pages, large images and play functions cost more. Treat that as a rough scale and time a real build.

A build is given a render budget of 15 minutes, or 15 seconds per capture for large builds, whichever is longer, so a slow but healthy build is not reported as hung. [Affected capture](/concepts/affected-capture/) renders only the stories a change touches and reuses the rest, which saves server time on large Storybooks.

## Scaling up

When one host is not enough, add instances rather than a second kind of service:

- **More instances.** Every instance that has capture enabled takes jobs from the shared database queue. Point them at the same Postgres or MySQL database and the same object storage (S3, Azure or GCS), not at local disk.
- **Shards.** Split a very large build across instances with `testing.shardSize`. See [Sharding big builds](/concepts/capture/#sharding-big-builds).
- **Browsers elsewhere.** List remote browsers (a self-hosted Playwright server or a hosted service) and the app host needs no browsers of its own. See [Remote browsers](/guides/remote-browsers/).

## Working out the cost

Add up what you run:

1. **Compute.** One host or container, sized as above. Capture needs a long-running host; a container platform that keeps CPU allocated (for example Cloud Run with CPU always allocated, which the Google Cloud reference stack uses) suits it better than one that throttles idle CPU.
2. **Storage.** The gigabytes of changed screenshots and Storybooks you keep, at your provider's rate, plus its request and transfer charges.
3. **Database.** SQLite costs nothing extra; a managed database is a small instance (the Google Cloud reference stack defaults to a shared-core Cloud SQL `db-f1-micro`).
4. **Optional services.** A load balancer or DNS and certificates, an email provider, an AI provider if you enable [AI insights](/ai/) (it has its own daily token budget), or remote browsers.

Because nothing scales with snapshot count, the bill follows how much you capture and keep, which you control with the capture settings and retention. For a side-by-side with a billed-per-snapshot service, see the [comparison with Chromatic](/guides/chromatic-comparison/).

## Check it against reality

At the start of every render the runner logs a `capture sizing` line with the CPUs and memory it detected and the concurrency and timeout it chose. The System page shows which browsers are ready. If a host behaves differently from the table, start there, then set the values explicitly. If the platform reserves CPU in a way the container cannot see, the detection cannot know.
