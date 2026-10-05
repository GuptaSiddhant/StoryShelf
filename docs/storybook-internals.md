# Storybook Internals — A Study Guide for StoryShelf

> A tour of how Storybook works under the hood, written for people working on StoryShelf. It
> follows Storybook's source (`storybookjs/storybook`, branch `next`, which matches the
> consolidated `code/core/src` layout of v9+, and is semantically identical to the v8/9/10 the
> fixtures build). It maps every internal to a StoryShelf touch-point and ends with a chapter on
> what StoryShelf *could* do with Storybook internals that it doesn't yet.

## 0. The one core idea: Storybook is two apps glued by a message bus

Every Storybook is **two completely separate web applications**:

| | Manager | Preview |
|---|---|---|
| What it is | The UI chrome: sidebar, toolbar, panels, addons | The canvas that renders your stories |
| Entry point | `index.html` (bundle in `sb-manager/`) | `iframe.html` (bundle in `iframe.html` + `assets/*.js`) |
| Runs in | The top-level window | An `<iframe id="storybook-preview-iframe">` |
| Owns | Story index, selection state, addon UI | CSF modules, decorators, args, renderers, `play` |

They share **no runtime state** — no globals, no shared DOM, no module scope. The only duct between
them is a **Channel**: an event bus with pluggable transports. In the browser that transport is
**`window.postMessage`**. This isolation is by design: the preview must be a sandbox (it runs
arbitrary user component code; in refs it may even be a different origin).

StoryShelf exploits exactly that isolation — it serves `iframe.html` with no manager at all and
captures it server-side. Everything in chapters 1–6 is the machinery *behind* the single URL
`iframe.html?id=<storyId>&viewMode=story` that `StorybookAdapter.buildUrl` produces.

## 1. The Channel (`code/core/src/channels/`)

### The `Channel` class — `channels/channel.ts`

A fancier `EventEmitter`: `channel.on(type, cb)`, `channel.emit(type, ...args)`, plus `once`, `off`,
and `isAsync`. The unit of protocol is the `ChannelEvent`: `{ type, args, from, source?, refId? }`.
`ChannelTransport` is the seam that decides *how* an event physically crosses a boundary. One
`Channel` can own several transports (postMessage + websocket + telemetry) and never knows which is
in play.

### The transports

- **`PostMessageTransport`** — `channels/postmessage/index.ts`. Manager ↔ preview inside the
  browser. **This is the famous "postMessage to iframe".**
- **`WebsocketTransport`** — `channels/websocket/index.ts`. Browser ↔ Node dev server at
  `/storybook-server-channel`.
- **`ServerChannelTransport`** — the Node side of that socket
  (`core-server/utils/get-server-channel.ts`).
- Telemetry + the shared `Channel` for in-app events — ancillary.

## 2. The postMessage protocol (the part everyone asks about)

From `channels/postmessage/index.ts` (`PostMessageTransport`). **Sending:**

```ts
const data = stringify(
  { key: 'storybook-channel', event, refId: query.get('refId') },
  { maxDepth: 25 },
);
frames.forEach((f) => f.postMessage(data, '*'));
```

Four details matter:

1. **`key: 'storybook-channel'`** — a namespace prefix. A page can host multiple Storybooks (or
   refs); a receiver ignores any message without this key.
2. **`telejson` serialization** — *not* `JSON.stringify`. `telejson` round-trips `Date`, `RegExp`,
   `Map`, `Set`, `Error`, `Symbol`, `undefined`, circular refs — capped at `maxDepth`. Addon payloads
   with exotic values survive the wire.
3. **`target: '*'`** — no origin on send. The "security model" is: the *receiver* stamps and checks
   `event.source` and ignores cross-origin noise.
4. **`refId`** — for **composed Storybooks** (one Storybook embedding another as a ref), events carry
   the source ref so the manager can route them. Read from the URL's `?refId=`.

**Frame targeting** — who do you post to?

- **Manager side**: `iframe[data-is-storybook][data-is-loaded]` (fallback `#storybook-preview-iframe`).
- **Preview side**: `globalThis.parent` (or nothing, when not framed).

**Receiving** (`handleEvent`):

```ts
const { key, event, refId } = parse(data, CHANNEL_OPTIONS);
if (key === 'storybook-channel') {
  event.refId = refId;
  event.source = page === 'preview' ? rawEvent.origin : getEventSourceUrl(rawEvent, refId);
  this.handler(event);
}
```

- `event.source` is the sender's **origin** (preview side) or the framing URL (manager side) — that
  is how the other side tells a legitimate peer from noise.
- **Buffering**: `send` before any target frame exists queues the event; the manager flushes when the
  preview first posts a message (the "sync-start" in open-service parlance) — i.e. when the iframe is
  finally a reachable `contentWindow`.

Version note: the envelope `{ key, event, refId }` has been stable from v6 (`@storybook/channel-postmessage`)
through v10. Only the package location moved.

## 3. The event vocabulary (`core-events`)

`code/core/src/core-events/index.ts` is the canonical list (~100 named events). The most instructive:

| Event | Direction | Meaning |
|---|---|---|
| `SET_CURRENT_STORY` | manager → preview | "render story `X` in viewMode `Y`" |
| `FORCE_RE_RENDER` / `FORCE_REMOUNT` | manager → preview | re-render / fully remount |
| `UPDATE_GLOBALS` | manager → preview | set global args (theme, locale, background…) |
| `GLOBALS_UPDATED` / `SET_GLOBALS` | preview → manager | acknowledge / announce globals |
| `UPDATE_STORY_ARGS` | manager → preview | live-edit a story's args (controls panel) |
| `STORY_RENDER_PHASE_CHANGED` | preview → manager | `loading → rendering → playing → play-failed → completed` |
| `STORY_RENDERED` | preview → manager | story painted in `#storybook-root` |
| `STORY_ERRORED` / `STORY_THREW_EXCEPTION` | preview → manager | render / exception failure |
| `PLAY_FUNCTION_THREW_EXCEPTION` | preview → manager | `play()` rejected — **StoryShelf subscribes to this** |
| `STORY_FINISHED` | preview → manager | render + play fully settled (v9+) |

**The canonical trace — click a story in the sidebar:**

1. `manager-api` emits `SET_CURRENT_STORY` → `PostMessageTransport` → `postMessage`.
2. Preview `handleEvent` → `PreviewWeb.onSetCurrentStory(storyId)` → `UrlStore` updates the URL →
   a `StoryRender` instance renders → the framework renderer paints `#storybook-root`.
3. Preview emits `STORY_RENDER_PHASE_CHANGED` + `STORY_RENDERED` back down.
4. The manager updates the outer URL, sidebar highlight, and addon panels.

Selection state is **never shared**, it travels as messages in both directions. That exchange *is* the
design.

## 4. Preview boot and the render pipeline

### `iframe.html` — the URL StoryShelf navigates to

A tiny HTML shell. The builder injects critical globals before the preview bundle runs:

- `CONFIG_TYPE` — `'DEVELOPMENT' | 'PRODUCTION'`
- `window.__STORYBOOK_PREVIEW__` — the `PreviewWeb` instance
- `window.__STORYBOOK_ADDONS_CHANNEL__` — the `Channel` instance

When StoryShelf opens `iframe.html?id=...&viewMode=story` **with no manager on the page**, the
`UrlStore` initializes the preview in standalone mode: it reads `?id=` itself, renders immediately,
and its channel simply never connects to anything. Nobody broadcasts `SET_CURRENT_STORY` at it.

### `PreviewWeb` (`preview-api/modules/preview-web/PreviewWeb.ts`)

1. Parse the URL (`UrlStore`) → `{ storyId, viewMode }`.
2. Load the **story index** — the same `index.json` / `stories.json` StoryShelf parses offline. It
   maps `storyId → importPath` so the store can `import()` the CSF module.
3. **Load CSF files** (`StoryStore.loadCSFFileByStoryId`).
4. **Prepare the story** (below).
5. `renderStoryToCanvas(...)`.

### CSF → renderable story (`preview-api/modules/store/csf/prepareStory.ts`)

A CSF module is not directly renderable. `prepareStory` composes module annotations:

```
global annotations (.storybook/preview.ts)
+ component annotations (Meta)
+ story annotations (StoryObj)
────→ decorators[], parameters (merged), args (merged), loaders[], play, tags
```

into a **`PreparedStory`** (`renderToCanvas`, `play`, `applyLoaders`…). The framework **renderer**
implements `renderToCanvas({ storyFn, showMain, showError, forceRemount }, canvasElement)` — see
`code/renderers/*/src/render.ts` — and renders into the element **`#storybook-root`**.

> This is the handshake with StoryShelf: `#storybook-root` is the `screenshotSelector`
> (`core/src/capture/storybook.ts:35`) and the `canvasElement` passed into `play({ canvasElement })`.

### The `StoryRender` state machine (`preview-web/render/StoryRender.ts`)

`STORY_RENDERED`, phase changes, play execution, and error reporting all originate here, emitted over
the channel.

## 5. Play functions (the part StoryShelf exercises most)

`play` runs **inside the preview document** with a context including
`{ canvasElement /* #storybook-root */, viewMode, step, id, globals, args, parameters }`.

Flow: phase `rendering` → `playing` → run `play({ canvasElement })` → on throw emit
`PLAY_FUNCTION_THREW_EXCEPTION` → phase `play-failed` → then `STORY_FINISHED` with the error.

**Read `packages/runner-playwright/src/capture-runner.ts:206-266` with this in mind.** In one
`page.evaluate` it:

1. reads `window.__STORYBOOK_PREVIEW__` (the `PreviewWeb` instance),
2. subscribes `preview.channel.on('playFunctionThrewException', handler)` — reading the preview side
   of the protocol directly,
3. prefers `preview.executePlay(storyId)` — a **custom StoryShelf preview addition** (injected into
   the client build, see ADR 0017 `Links`),
4. falls back to `preview.storyStore.fromId(storyId).play({ canvasElement })` — reaching into the
   store for the `PreparedStory.play`.

`storyStore.storyIndex.entries` is the in-browser twin of the `stories.json`/`index.json` StoryShelf
reads offline: same shape (`id, name, title, importPath, type, subtype, tags`). That is why the
adapter can be presence-based instead of version-detecting.

## 6. Manager and addons (the side StoryShelf deliberately skips)

- The manager bundle (`code/core/src/manager/`) builds the React UI from the story index + render
  events.
- **Addons register in *both* apps**: a manager-side panel + an optional preview-side decorator /
  preview module, glued by the channel. Study `addon-interactions` (play steps driven by
  `STORY_RENDER_PHASE_CHANGED`) or `addon-a11y` (checks in preview, reports to manager) as the
  canonical pair.
- `manager-api` (`useChannel`, `useParameter`, `addons`, `selectStory`) is the documented bridge.

**Why StoryShelf ships no postMessage bridge:** capture is server-side and talks to *neither* app
over the channel. It navigates the bare preview iframe and reads the DOM. PostMessage only matters
when the *manager* is alive to send it; to drive a story without a manager, you poke
`__STORYBOOK_PREVIEW__` directly — which is exactly what the runner does.

## 7. The server channel (dev mode only)

In `storybook dev`, a Node server is a third peer: `core-server/utils/get-server-channel.ts` upgrades
`/storybook-server-channel` to WebSocket; mirrored `WebsocketTransport`s run in the manager and
preview. It carries HMR notifications, telemetry, "open in editor", and file search, with a ping/pong
heartbeat and event buffering until `isReady`. A static production build has **no server channel** —
`CONFIG_TYPE=PRODUCTION`, manager + preview only.

## 8. Version drift map (the fixtures cover SB 8/9/10)

- **v6–v7 monorepo package names** you'll hit in old blog posts: `@storybook/channel-postmessage`,
  `@storybook/channels`, `@storybook/core-events`, `@storybook/preview-web`, `@storybook/store`,
  `@storybook/addons`.
- **v8+**: packages consolidated; import shims like `storybook/internal/channels`;
  `features.buildStoriesJson` → the `STORYBOOK_BUILD_STORIES_JSON` env the CLI injects at
  `cli/src/commands/storybook-build.ts:66` so v8 emits `stories.json`.
- **v9/v10**: `open-service` — an *internal*, schema-driven service subsystem relaying state between
  manager/preview/server over the channel (`code/core/src/shared/open-service/`); it is an internal
  Storybook feature, **not** a stable external integration API (all services are marked
  `internal: true`). `STORY_FINISHED` replaces/augments older render events; **CSF-Next** `.test()`
  stories appear in the index as `subtype: 'test'` — which is why StoryShelf's `discover()` filters
  them out. Storybook's `addon-vitest` / `addon-test` turn `.test()` stories into real browser tests
  via Vitest + portable stories; `@storybook/test-runner` does the same against a running/published
  Storybook.

## 9. Observing it live (15-minute lab)

```bash
cd fixtures/storybook-8 && pnpm run build-storybook && pnpm dlx serve storybook-static -l 6007
```

Open the top-level console and the iframe's console, run:

```js
addEventListener('message', (e) => console.log('SB-channel:', e.data));
```

Click stories and watch the `{"key":"storybook-channel","event":{...}}` envelopes. Then introspect
the globals StoryShelf runs off:

```js
window.__STORYBOOK_ADDONS_CHANNEL__   // .transports, .emit(), .on()
window.__STORYBOOK_PREVIEW__          // .channel, .storyStore.storyIndex.entries, .storyStore.fromId('<id>').play, .extract()
```

Force a re-render through the bus:

```js
window.__STORYBOOK_ADDONS_CHANNEL__.emit('updateGlobals', { globals: { /* any global */ } });
```

Watch `sb-manager/` vs `assets/*.js` split in the Network tab; with `storybook dev`, watch the
`/storybook-server-channel` WebSocket heartbeats behind `document`.

## 10. What StoryShelf can do with Storybook internals (next chapter)

Opportunities, grouped by leverage. **None are commitments** — they're the ideas that surfaced from
mapping chapter 1–9 onto the current code. Each is tagged with the Storybook version it needs and an
effort/impact estimate.

### 10.1 Close the documented-but-unimplemented gaps (low effort, high integrity)

- **Runtime parameter fallback.** ADR 0017 and the website guide promise
  `page.evaluate(() => __STORYBOOK_PREVIEW__.extract()[id].parameters)` as the fallback for SB 8
  builds without `buildStoriesJson`. The runners don't implement it today — only
  `files stories.json / index.json` are read. The fallback page-evaluates once per story *only* when
  `stories.json` is absent, so it's cheap. This is the single most obvious correctness debt.
- **`waitForReady(page)`.** ADR 0005's `StorySourceAdapter` declares an optional `waitForReady`
  hook that is never implemented or called. Framework-specific providers could use it to gate the
  screenshot on something more precise than `networkidle + delay`.

### 10.2 Render-settled signalling instead of fixed sleeps (medium effort, high fidelity)

The capture pipeline waits `networkidle` + `parameters.delay ?? 500ms` then screenshots. It already
**has a channel inside the page** — the runner could subscribe before rendering and resolve on the
render-finished signal rather than a clock:

- `STORY_RENDERED` (story painted) and — when `executePlay` — `STORY_FINISHED`
  (render + play fully settled) are the exact "stop" signals the manager uses. Waiting on them beats
  a magic 500 ms: faster for fast stories, correct for slow ones, and immune to `networkidle` flakery
  on long-polling previews.
- The phase trail (`STORY_RENDER_PHASE_CHANGED`) plus `UNHANDLED_ERRORS_WHILE_PLAYING` gives much
  richer failure diagnostics than today's "play failed: <message>" — StoryShelf could record *where*
  in the interaction run a story failed.

### 10.3 Drive stories like the manager (modes / args / globals) (medium — the biggest product lever)

Chromatic's "modes" (viewports + backgrounds) are manager-style channel broadcasts applied before a
capture. StoryShelf's runner could emit the same events via the in-page channel instead of only
resizing the viewport:

- `UPDATE_STORY_ARGS` / `UPDATE_GLOBALS` before screenshot → an **args matrix** feature
  (`parameters.storyshelf.args` overrides) without any StoryShelf-side renderer work — the preview
  does the re-render.
- A per-story `background` / `theme` selection in the same way — honoring what the user configured in
  Storybook's own toolbar.
- Caveat: capturing the *same* story at N arg sets multiplies snapshots and baseline bookkeeping
  (snapshot rows are currently `story_id × viewport`). Needs a deliberate schema decision before it's
  worth it.

### 10.4 Per-story viewports from Storybook's own parameters (low effort)

`stories.json` carries full `parameters` per story, including `parameters.viewport.defaultViewport`
and `parameters.backgrounds.values`. StoryShelf only reads the `chromatic`/`storyshelf` sub-keys
today. Honoring `parameters.viewport` would make captures match what the developer sees in Storybook,
and resolves the deferred "per-story viewports" item (ADR 0017 "Alternatives considered") without an
explicit schema: map the named viewport to a size from the index's viewport addon data.

### 10.5 Run CSF-Next `.test()` stories as interaction tests (medium — aligns with ADR 0017)

`discover()` filters `subtype === 'test'`. Those stories *are* tests written in the file (CSF-Next,
fixtures/storybook-10) — the very "one less CI job" StoryShelf already sells for `play`. A dedicated
"run tests" mode could execute `.test()` stories in the iframe (Storybook runs them through the
portable-stories pipeline, so the exact in-page entry point needs verifying — it may not be
`storyStore.fromId().play()` like a classic story) and report pass/fail alongside snapshots, giving
Storybook-10 users interaction-test CI without adding Vitest. The assertion runtime (`expect` from `@storybook/test`) throws like any `play` throw,
so the failure plumbing already exists. Caveat: `.test()` bodies are the *whole* test (no separate
snapshot target), so this is a status report, not a screenshot — it needs a new build status lane,
not a snapshot row.

### 10.6 Autodocs / `viewMode=docs` capture (low effort, product niche)

`iframe.html?id=<id>&viewMode=docs` renders Autodocs pages (`type === 'docs'` entries, currently
filtered out). A docs snapshot is a real page capture — no DOM root constraint (`#storybook-root`
doesn't exist in docs mode; the content root is `[data-overview-component]` / `.sbdocs`). Chromatic
doesn't snapshot docs, so this is a cheap differentiator. Needs the docs entries kept during discovery
and an adapter `screenshotSelector` per view mode.

### 10.7 Lean on the addons you'd otherwise reimplement (parking-lot)

- **a11y**: today's `checkA11y` is a hand-rolled DOM scan (`capture-runner.ts:339-376`).
  `addon-a11y` runs axe in the preview and pushes results over the channel; reusing its internals (or
  swapping to `@axe-core/playwright`) would give real WCAG coverage instead of 4 hand-picked rules.
- **interactions panel**: sidebar/test-status indicators in the manager are driven by
  `STORY_RENDER_PHASE_CHANGED`; the same protocol could one day drive a StoryShelf build-review
  "play trace" panel.

### 10.8 Do *not* reach for (honest limits)

- **`open-service`**: the schema-driven state service in v9/10 is internal (`internal: true` on every
  core service) and explicitly unstable. It powers Storybook's own docgen/change-detection, not third
  parties. Watching it is smart; building on it would be building on sand.
- **The postMessage channel as a StoryShelf transport**: StoryShelf captures server-side and never
  runs a manager. The channel is only reachable *inside* the page (as a passive listener, which it
  already does) — there is no manager peer to relay to.

## Appendix — StoryShelf ↔ Storybook cheat sheet

| StoryShelf code | Storybook internal it touches |
|---|---|
| `StorybookAdapter.buildUrl` (`core/src/capture/storybook.ts:53`) | Skips manager; standalone preview URL routing |
| `screenshotSelector = "#storybook-root"` | `renderToCanvas` paint target / `play.canvasElement` |
| `readIndex` → `stories.json`/`index.json` | The story index the manager also consumes |
| `__STORYBOOK_PREVIEW__` (`runner-*/capture-runner.ts`) | `PreviewWeb` instance |
| `.channel.on('playFunctionThrewException')` | Preview→manager protocol, read in-page |
| `.executePlay(storyId)` | Custom StoryShelf preview augmentation |
| `.storyStore.fromId(id).play({ canvasElement })` | `StoryStore` → `PreparedStory.play` |
| CLI `STORYBOOK_BUILD_STORIES_JSON=true` | Forces v8 to emit `stories.json` |
| `discover()` filters `subtype === 'test'` | CSF-Next `.test()` story marking |
| `parameters.*` (chromatic/storyshelf keys) | Story index `parameters` section |