# StoryShelf Storybook v8 Fixture

A minimal, deterministic Storybook used as the capture test fixture and as the "try it" sample.

- Two `Button` variants, system fonts, no network or external assets — so captures are stable across runs.
- `nub run storybook` to develop; `nub run build-storybook` to produce `storybook-static/` (which the CLI uploads to StoryShelf). `storybook-static/` is committed so the capture smoke test and `test:integration` suite need no build step.
