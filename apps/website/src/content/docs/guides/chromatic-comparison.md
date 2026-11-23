---
title: StoryShelf vs Chromatic
description: A factual feature and hosting comparison of StoryShelf and Chromatic for teams evaluating visual testing tools for Storybook.
---

This page compares Chromatic, a hosted service, with StoryShelf, which you host yourself. It describes both and makes no recommendation. Statements about Chromatic come from its public pages, linked under [Sources](#sources) and checked on 14 November 2026; Chromatic can change its plans and features, so check them before you decide. Where a Chromatic detail is not stated publicly, this page leaves it out.

## At a glance

| Aspect                | Chromatic                                                            | StoryShelf                                                                               |
| --------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Hosting**           | Hosted by Chromatic                                                  | Self-hosted on your infrastructure                                                       |
| **Pricing model**     | Plans with a monthly allowance of billed snapshots                   | MIT licence, no snapshot billing; you pay for your own infrastructure                    |
| **Browsers**          | Chrome by default; Firefox, Safari and Edge on paid plans            | Chromium (default), Firefox and WebKit through Playwright                                |
| **Affected capture**  | TurboSnap, from Git history and the Webpack or Vite dependency graph | Affected capture from `preview-stats.json` (Vite, with tolerant Webpack shapes)          |
| **Modes and globals** | Modes                                                                | `parameters.chromatic.modes` and `parameters.storyshelf.modes` ([Modes](/guides/modes/)) |
| **Accessibility**     | Accessibility testing                                                | axe-core checks, on by default, shown in review and never blocking                       |
| **Interaction tests** | `play` functions                                                     | `play` functions                                                                         |
| **Single sign-on**    | Enterprise plan                                                      | Any OIDC provider, through Better Auth                                                   |
| **Source licence**    | Proprietary service                                                  | MIT, open source                                                                         |
| **Data location**     | Chromatic's infrastructure                                           | Your database and storage, wherever you run them                                         |

## Pricing

Chromatic's pricing page lists these plans:

| Plan       | Price      | Billed snapshots per month | Notable inclusions               |
| ---------- | ---------- | -------------------------- | -------------------------------- |
| Free       | $0/month   | 5,000                      | Chrome testing                   |
| Starter    | $179/month | 35,000                     | Safari, Firefox and Edge testing |
| Pro        | $399/month | 85,000                     | Custom domain                    |
| Enterprise | Custom     | Customizable               | SSO, priority support, SLA       |

Chromatic says TurboSnap-reused snapshots "count less toward your usage". StoryShelf does not bill per snapshot, so skipping unaffected stories saves server time, not money.

StoryShelf costs what your servers, database and object storage cost. Capture time grows with the number of stories, browsers and viewports you render, so see [Sizing](/guides/sizing/) before you plan capacity.

## How they differ in design

| Aspect        | Chromatic            | StoryShelf                                                                                          |
| ------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| **Capture**   | Run by Chromatic     | Run by your server: Playwright (Chromium, Firefox, WebKit)                                          |
| **Baselines** | Managed by Chromatic | Per branch, with fallback to the default branch; looked up by key, with no walk through Git history |
| **Storage**   | Managed by Chromatic | Local disk, S3-compatible storage, Azure Blob Storage or Google Cloud Storage                       |
| **Database**  | Managed by Chromatic | SQLite, Postgres or MySQL                                                                           |
| **Job queue** | Managed by Chromatic | A table in your database, with no extra service                                                     |
| **Sign-in**   | Chromatic accounts   | Local accounts, social sign-in, OIDC single sign-on, passkeys, or none                              |

## Where StoryShelf does less

- **Browsers.** Chromium, Firefox and WebKit are selectable per project, with up to three per project and per-engine baselines. StoryShelf does not drive branded Safari or Edge.
- **Affected capture.** It reads `preview-stats.json`, so it works best on Vite Storybooks. Builders without stats fall back to rendering every story.
- **Accessibility.** Results are annotations. They never fail a build, and there is no accessibility baseline.
- **Parallelism.** Concurrency is limited by your own server (`testing.concurrency`).
- **Flaky stories.** There is no automatic flake detection; mark a story with `flakyTest` or a tag.
- **Operations.** You run, back up and upgrade it.

## Where StoryShelf does more

- No per-snapshot billing, and no limit on projects or users beyond your own resources.
- Your data stays in your own database and storage, and the source is MIT licensed.
- It runs wherever you can run a Node.js service, such as Docker, Fly.io or your own servers.
- Any OIDC provider works for sign-in, with no plan requirement.

## Moving from Chromatic

| Item           | Notes                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------- |
| **Baselines**  | Chromatic offers no baseline export, so the first StoryShelf build needs re-acceptance.        |
| **Parameters** | `chromatic:` and `storyshelf:` keys both work; `storyshelf:` wins on conflict.                 |
| **Modes**      | Existing `parameters.chromatic.modes` work unchanged ([Modes](/guides/modes/)).                |
| **Affected**   | Stories are skipped only on Vite Storybooks; expect more snapshots on other builders at first. |

Step by step: [Migrating from Chromatic](/guides/chromatic-migration/). Coming from Lost Pixel instead? See the [Lost Pixel migration guide](/guides/lost-pixel-migration/).

## Sources

- [Chromatic pricing](https://www.chromatic.com/pricing): plans, prices, allowances, SSO.
- [Chromatic browser support](https://www.chromatic.com/docs/browsers/): Chrome, Firefox, Safari and Edge.
- [Chromatic TurboSnap](https://www.chromatic.com/docs/turbosnap/): Git history and the Webpack or Vite dependency graph.

Chromatic is a trademark of its owner. StoryShelf is not affiliated with or endorsed by Chromatic.
