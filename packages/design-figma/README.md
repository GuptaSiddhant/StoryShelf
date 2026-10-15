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
import { createFigmaDesign } from "@storyshelf/design-figma";
import { createShelfApp } from "@storyshelf/app";

const app = createShelfApp({
  database,
  storage,
  // ...adapters...
  design: [createFigmaDesign()],
});
```

Without a provider, StoryShelf shows no design links. With it, stories link to Figma through `parameters.storyshelf.figma` or the Storybook `design` addon, and project admins manage mappings and the access token under **Settings → Design**.

Remote capture workers need the same provider (`createCaptureWorker({ design: [createFigmaDesign()] })`) so declared links are validated during capture.

## Accepted links

`https://www.figma.com/{file|design|board|proto|make}/<key>/…` with an optional `node-id`. Embed, community and Figma Sites links are rejected.
