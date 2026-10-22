---
title: How Storybook works
description: The parts of a built Storybook that StoryShelf relies on — the two apps, the story index, the preview page and play functions — and how they differ across Storybook 8, 9 and 10.
---

StoryShelf never runs your Storybook the way you do in development. It takes the **static build**, serves the files, opens one page per story and takes a screenshot. This page explains the pieces of a Storybook that makes possible, so you can tell why a story captures the way it does and what to check when it does not.

It describes how StoryShelf uses Storybook 8, 9 and 10 (all three are tested against real builds). Storybook's own internals are not a public API and can change between releases, so StoryShelf keeps its contact surface small, as described in [What StoryShelf relies on](#what-storyshelf-relies-on).

## Two apps in one build

A built Storybook is two separate web applications:

|             | Manager                                       | Preview                                                |
| ----------- | --------------------------------------------- | ------------------------------------------------------ |
| What it is  | The chrome: sidebar, toolbar, panels, addons  | The canvas that renders your stories                   |
| Entry point | `index.html` (its bundle is in `sb-manager/`) | `iframe.html` (its bundle is in `assets/`)             |
| Runs in     | The top-level window                          | An `iframe` inside the manager                         |
| Owns        | The story list, selection, addon panels       | Your story modules, decorators, args, `play` functions |

They share no state: no globals, no DOM, no module scope. The manager and the preview talk only by sending messages to each other through a channel (in the browser, `window.postMessage` messages tagged with the key `storybook-channel`). When you click a story in the sidebar, the manager sends a message, and the preview renders the story and reports back.

**StoryShelf uses the preview only.** The page it opens is

```text
<storybook>/iframe.html?id=<story-id>&viewMode=story
```

With no manager on the page, nothing sends the preview a "show this story" message, so the preview reads the story id from the URL and renders it straight away. The screenshot is of the element `#storybook-root`, where Storybook's framework renderers paint the story. [Modes](/guides/modes/) add a `globals` parameter to the same URL (for example `&globals=theme:dark`), which Storybook applies before the story renders.

## What is in the build

A `storybook build` output holds, among other files:

- `iframe.html` and `assets/`: the preview, which every capture loads.
- `index.html` and `sb-manager/`: the manager, which captures never open. It is still part of a [published Storybook](/concepts/publishing/), where people browse the full UI.
- `index.json`: the story index. StoryShelf reads `stories.json` when a build has one and `index.json` otherwise.

`iframe.html` of a production build sets `CONFIG_TYPE` to `PRODUCTION`. A static build has no development server behind it, so there are no hot-reload sockets or other dev-only traffic to wait for.

## The story index

The index is a JSON object with one entry per story. In the Storybook 8, 9 and 10 builds StoryShelf is tested with, an entry carries `id`, `name`, `title`, `importPath`, `tags` and `type`; Storybook 10 adds `subtype` and `exportName`.

StoryShelf captures the entries that are stories. It leaves out:

- **docs entries** (`type: "docs"`), the Autodocs and MDX pages;
- **test entries** (`subtype: "test"`), which Storybook 10 creates for CSF Next `.test()` functions. They are tests, not visual states.

The index does **not** list story parameters, so settings such as `chromatic`/`storyshelf` parameters, [modes](/guides/modes/) and viewport defaults are read from the running preview instead (see [How parameters are discovered](/guides/interaction-testing/#how-parameters-are-discovered)). The index is also what [affected capture](/concepts/affected-capture/) and the component library start from: `importPath` says which source file each story comes from.

## How the preview boots and when StoryShelf screenshots

When the page loads, Storybook's preview does the following, in order:

1. Reads the story id and view mode from the URL.
2. Loads the story index and finds the story's `importPath`.
3. Imports that file (a CSF module) and combines the project-wide settings from `.storybook/preview`, the file's `meta` and the story itself into one prepared story: decorators, merged parameters, merged args, loaders and the `play` function.
4. Hands the story to the framework renderer (React, Vue, and so on), which paints it into `#storybook-root`.

StoryShelf waits for the page to go quiet (no network traffic), then for `#storybook-root` to exist, then for the story's `delay` parameter (500 ms by default) before it takes the screenshot. Slow stories that animate or load data late need a larger [`delay`](/guides/interaction-testing/#per-story-controls) so the wait covers them.

The preview keeps a handle on itself as `window.__STORYBOOK_PREVIEW__`. This is the one in-page object StoryShelf talks to.

## Play functions

A story's `play` function runs inside the preview page after the story has rendered, with the story's context (args, parameters, globals) and the `canvasElement` it rendered into. With [interaction testing](/guides/interaction-testing/) on, the runner runs it before the screenshot, so the image shows the story after the interactions:

1. In the page, it finds the story through `__STORYBOOK_PREVIEW__`: Storybook 8, 9 and 10 expose a store that can load one story on demand, and the runner runs that story's play function with the context of the render already on screen. A preview that offers an `executePlay` method is asked to run it instead; none of the 8, 9 or 10 builds tested here does.
2. It listens on the preview's channel for `playFunctionThrewException`, the event Storybook raises when `play` fails.
3. It races the play function against the project's play timeout. A throw, a reported play exception or a timeout fails the capture with `play failed: <message>`.

Accessibility checks follow the same pattern: the runner reads the story's `parameters.a11y` from the current render and runs axe against `#storybook-root`. Only plain data survives that read, so function values in `parameters.a11y` are dropped.

## What StoryShelf relies on

StoryShelf treats Storybook as a black box with two doors:

- the **URL** `iframe.html?id=…&viewMode=story` (plus `globals` for modes), and
- the **`window.__STORYBOOK_PREVIEW__`** object in that page, to read parameters, run `play` functions and read a11y parameters.

Both are checked for presence, not for a Storybook version number: if the object or one of its methods is missing, the runner skips that feature instead of failing the build.

It deliberately does **not** build on:

- the **channel protocol** as a transport. StoryShelf has no manager to talk to; it only listens on the preview's channel for the play failure event.
- Storybook's internal **services**. They are internal to Storybook and not a supported way for tools to integrate.

## Differences between Storybook 8, 9 and 10

|                                                                   | Storybook 8                                   | Storybook 9               | Storybook 10                                                        |
| ----------------------------------------------------------------- | --------------------------------------------- | ------------------------- | ------------------------------------------------------------------- |
| Index file                                                        | `index.json` (format version 5)               | `index.json` (5)          | `index.json` (5)                                                    |
| Index entries                                                     | `type: "story"`                               | `type: "story"`           | `type: "story"` plus `subtype` (`story` or `test`) and `exportName` |
| Parameters in the index                                           | No                                            | No                        | No                                                                  |
| `.test()` stories (CSF Next)                                      | No `subtype` in the index                     | No `subtype` in the index | In the index with `subtype: "test"`; skipped by StoryShelf          |
| `iframe.html` preview, `#storybook-root`, `__STORYBOOK_PREVIEW__` | Yes                                           | Yes                       | Yes                                                                 |
| Play function path                                                | Store loads one story, runs its play function | Same                      | Same                                                                |
| `globals` URL parameter for modes                                 | Works                                         | Works                     | Works                                                               |

StoryShelf ships a test fixture for each version (`fixtures/storybook-8`, `-9` and `-10`, Vite and React), and its gated browser suite captures every one of them.

## Cheat sheet

| StoryShelf does                                           | Storybook feature it uses                                      |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| Opens `iframe.html?id=<id>&viewMode=story`                | The standalone preview; no manager, no channel messages needed |
| Adds `&globals=…` for a [mode](/guides/modes/)            | Storybook globals set from the URL before the story renders    |
| Screenshots `#storybook-root`                             | The element framework renderers paint stories into             |
| Reads `stories.json` or `index.json`                      | The story index: ids, titles, import paths, tags, type         |
| Skips `type: "docs"` and `subtype: "test"` entries        | MDX/Autodocs pages and CSF Next test functions                 |
| Reads parameters through `__STORYBOOK_PREVIEW__`          | The preview instance and its resolved story parameters         |
| Runs a story's `play` function                            | The preview's store: load the story, call its play function    |
| Fails on `playFunctionThrewException`                     | The channel event a failing play function raises               |
| Reads `parameters.a11y` and runs axe on `#storybook-root` | The current render's story parameters                          |

## Where to go next

- [Capture & viewports](/concepts/capture/): the pipeline around the page load described here.
- [Interaction testing](/guides/interaction-testing/): enabling `play` and the per-story controls.
- [Modes](/guides/modes/): themes and viewports through globals.
- [Playwright runner](/packages/runner-playwright/) and [Puppeteer runner](/packages/runner-puppeteer/): the packages that drive the page.
