# @storyshelf/design-figma

Figma design provider for StoryShelf: validates Figma links, reads file/node metadata (name, version, last modified) and downloads rendered previews through the Figma REST API with a personal access token.

## Install

```sh
nub add @storyshelf/design-figma
```

or

```sh
npm install @storyshelf/design-figma
```

## Quick start

```ts
import { createShelfApp } from "@storyshelf/app";
import { createFigmaDesign } from "@storyshelf/design-figma";

const app = createShelfApp({
  database,
  storage,
  testing: { runner: captureRunner },
  design: [createFigmaDesign()],
  config: {
    secret: process.env.SHELF_SECRET, // also encrypts the Figma token
  },
});
```

Without a provider, StoryShelf extracts and shows no design links. With it, stories link to Figma through `parameters.storyshelf.figma` or the Storybook `design` addon, and project admins manage mappings and the access token under **Settings → Design**. See [Design links](https://storyshelf.js.org/guides/design-links/) for how stories, mappings and the access token work.

## Let members connect their own account

Without a project token, a member can connect their own Figma account (like Jira or Linear integrations) and see previews, names and stale-design warnings with their own access. Register an OAuth app in Figma (**Settings → OAuth apps**; a private app works within your organization), add the redirect URL `<publicBaseUrl>/connections/figma/callback` and the `file_content:read` scope, then:

```ts
import { createFigmaDesign, figmaOAuthFromEnv } from "@storyshelf/design-figma";

design: [createFigmaDesign({ oauth: figmaOAuthFromEnv() })], // FIGMA_CLIENT_ID / FIGMA_CLIENT_SECRET
```

This needs authentication enabled and `config.secret` (it signs the connect flow and encrypts tokens). A project token, when set, always takes precedence; a member's token is used only while they view a page, and what it fetches is shown only to them.

## Accepted links

`https://www.figma.com/{file|design|board|proto|make}/<key>/…` with an optional `node-id`. Embed, community and Figma Sites links are rejected.
