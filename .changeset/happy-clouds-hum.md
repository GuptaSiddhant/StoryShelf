---
"@storyshelf/core": patch
"@storyshelf/app": patch
"@storyshelf/runner-playwright": patch
"@storyshelf/runner-puppeteer": patch
---

Accessibility: an inherited snapshot shows its baseline's findings behind a `from baseline <sha>` note, kept out of the build's own totals; a `Date`, `Set` or `Map` in `parameters.a11y` is read as an ISO string or an array, and a cyclic or too deeply nested parameter runs axe with its defaults and stores `a11y parameters not serializable: <reason>` as a note instead of looking like no parameter.
