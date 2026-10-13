---
title: Modes
description: Capture a story under different themes, locales and viewports with Chromatic-compatible `modes` parameters.
---

A **mode** is a named set of Storybook [globals](https://storybook.js.org/docs/essentials/toolbars-and-globals) (theme, locale, backgrounds, …) and an optional viewport. Every story is captured once per mode, and each mode keeps its own baseline and approval.

## Declare modes

Modes live in story parameters, at project, component or story level. Levels stack, so a story captures every mode declared above it. Both parameter keys work and are merged per mode name; `storyshelf` wins over `chromatic` for the same name.

```ts
// .storybook/preview.ts — every story
export default {
  parameters: {
    chromatic: {
      modes: {
        light: { theme: "light" },
        dark: { theme: "dark" },
      },
    },
  },
};

// Button.stories.ts — this component adds a narrow viewport
export default {
  parameters: {
    storyshelf: { modes: { mobile: { viewport: "mobile1", theme: "dark" } } },
  },
};
```

A mode value is:

| Key | Meaning |
| --- | --- |
| `viewport` | A width in px, a Storybook viewport name (`mobile1`, `tablet`, or one from `parameters.viewport.viewports`), or `{ width, height }`. Omitted: the project's first viewport. |
| `disable: true` | Skip an inherited mode (or viewport of the same name) for this story. |
| anything else | A Storybook global, passed on the iframe URL as `globals=…`. Nested objects flatten (`backgrounds: { value: "#fff" }` → `backgrounds.value:!hex(fff)`). |

:::note
Storybook only applies globals declared in your `globalTypes` / `initialGlobals`, and only values made of letters, digits, spaces, `_` and `-` (plus the `!true`/`!hex()` forms StoryShelf encodes for you). Anything else is silently ignored by Storybook.
:::

## Identity

A mode's baseline is keyed by the **slug of its name** (`Dark Desktop` → `dark-desktop`), not its values. Changing what a mode does keeps comparing against the same baseline; renaming it creates a new one, like renaming a story. A mode named like a project viewport (for example `desktop`) replaces that viewport's capture.

## Limits and settings

- At most **8** captures per story (project viewports + default viewport + modes). A story over the cap fails the build before anything renders.
- `modesAllowlist` on the project (a JSON list of mode names) restricts which declared modes run. Unset runs all of them.
- The Playwright runner reads modes from the running preview, so project-level and component-level modes are picked up without any index parameters. The Puppeteer runner only sees parameters present in `index.json`.
