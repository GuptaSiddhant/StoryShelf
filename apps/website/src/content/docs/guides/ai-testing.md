---
title: Free AI for testing
description: Try StoryShelf's AI insights cheaply with a free-tier hosted model or a local one — for test data only.
---

You do not need a paid plan to try [AI insights](/guides/ai-insights/). Pick one of the routes below, wire the model into your server assembly, then enable a profile for a **test project**.

:::caution[Use test data only]
Free tiers can log prompts or use them to improve models, and free models can change or disappear. Evidence includes story names, logs and (with vision) screenshots. Do not point a free-tier profile at a private project. Check each provider's current terms before use.
:::

## Local model (no data leaves your machine)

Run a local server such as [Ollama](https://ollama.com), which exposes an OpenAI-compatible API, and connect through the OpenAI-compatible provider:

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAi } from "@storyshelf/ai";

const local = createOpenAICompatible({ name: "ollama", baseURL: "http://localhost:11434/v1" });
const ai = createAi({
  profiles: { default: { defaultModel: local("<model-id you pulled>") } },
  budget: { perProjectCallsPerHour: 20 },
});
```

Small local models are slow and may need a longer `timeoutMs` (`{ model, timeoutMs: 180_000 }`). Skip screenshots by leaving the model text-only (the default).

## Google AI Studio

Create an API key in AI Studio, then use the Google provider with a model that is available on your key's free tier:

```ts
import { createGoogleGenerativeAI } from "@ai-sdk/google";

const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY });
const ai = createAi({
  profiles: { default: { defaultModel: google("<free-tier model id>") } },
  budget: { dailyTokens: 200_000, perProjectCallsPerHour: 10 },
});
```

## OpenRouter

OpenRouter offers some models at no cost and many at low cost behind one API key:

```ts
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
const ai = createAi({
  profiles: { default: { defaultModel: openrouter("<model id>") } },
  budget: { dailyTokens: 200_000, perProjectCallsPerHour: 10 },
});
```

## Tips

- Keep the budget small so a test run cannot burn through a free quota.
- Start text-only; add a `vision` model only when you want screenshots analyzed.
- Quality varies a lot between models. If answers are rejected as invalid, try a model with reliable JSON output.
- Remove the profile (Project settings → AI → Off) when you finish testing.
