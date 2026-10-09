# @storyshelf/ai

AI insights engine for StoryShelf (build triage and project health) on the Vercel AI SDK. See ADR 0026.

This package never sees API keys: you install a provider package yourself (`@ai-sdk/openai`, `@ai-sdk/anthropic`, Ollama, Bedrock, Vertex, …) and pass configured models in.

## Install

```sh
nub add @storyshelf/ai
```

## Usage

```ts
import { createAi } from "@storyshelf/ai";
import { createShelfApp } from "@storyshelf/app";
import { openai } from "@ai-sdk/openai";

const ai = createAi({
  profiles: { default: { defaultModel: openai("gpt-4o-mini") } },
});

const app = createShelfApp({ database, storage, ai });
```

Passing `ai` turns AI on site-wide; a site admin then enables it per project by choosing a profile in project settings.

## License

MIT
