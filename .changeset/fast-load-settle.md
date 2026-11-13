---
"@storyshelf/runner-playwright": patch
"@storyshelf/runner-puppeteer": patch
---

Changed: capture navigates to the `load` event instead of waiting for network idle (#856)

Each screenshot used to wait for 500 ms of network quiet before the settle step. Storybook's own render and play events already decide readiness, so the runners now navigate with `waitUntil: "load"` and keep the settle wait and the `delay ?? 500` fallback. Captures on the fixtures are byte-identical, and render time per screenshot drops by about 40% in the benchmark.
