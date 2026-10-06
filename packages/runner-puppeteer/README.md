# @storyshelf/runner-puppeteer

Puppeteer capture runner for StoryShelf (Chromium via chrome-headless-shell), a smaller-image alternative to the Playwright runner.

## Install

```sh
nub add @storyshelf/runner-puppeteer
```

or

```sh
npm install @storyshelf/runner-puppeteer
```

## Usage

```ts
import { createPuppeteerCaptureRunner } from "@storyshelf/runner-puppeteer";

const capture = createPuppeteerCaptureRunner();
```

See the [StoryShelf documentation](https://github.com/GuptaSiddhant/StoryShelf#readme) for configuration details.

## License

MIT
