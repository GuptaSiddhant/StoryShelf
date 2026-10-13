# StoryShelf Storybook v10 Fixture

A minimal, deterministic Storybook used as the capture test fixture and as the "try it" sample.

- Two `Button` variants, system fonts, no network or external assets — so captures are stable across runs.
- `nub run storybook` to develop; `nub run build-storybook` to produce `storybook-static/` (which the CLI uploads to StoryShelf). `storybook-static/` is committed so the capture smoke test and `test:integration` suite need no build step.
- A `theme` global (`light`/`dark`, applied to the page background) and two `Components/Themed` stories declare modes through both parameter keys (`storyshelf` and `chromatic`); the capture integration tests use them to check mode globals, per-mode viewports and multi-browser capture.
