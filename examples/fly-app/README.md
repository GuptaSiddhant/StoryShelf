# StoryShelf on Fly.io

Deploy StoryShelf as a public demo on Fly.io, seeded with the `examples/storybook` project.

## Prerequisites

- `flyctl` installed and authenticated.
- A built `packages/cli/dist` and `packages/node-server/dist` (run `nub run build` at the repo root first).

## Deploy

```sh
fly apps create storyshelf-demo
fly volumes create storyshelf_data --region iad --size 1
fly deploy --config fly.toml
```

## Notes

- The persistent Fly volume (`/data`) holds SQLite + screenshots, so baselines survive redeploys.
- Fly's `*.fly.dev` wildcard certs mean `publishedBaseDomain` subdomains work: set `PUBLISHED_BASE_DOMAIN=storyshelf-demo.fly.dev`.
- The Playwright base image provides the Chromium/WebKit/Firefox browsers used by the capture pipeline.
