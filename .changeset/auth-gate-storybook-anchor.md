---
"@storyshelf/app": patch
---

Security fix: the sign-in gate let an anonymous request through to any project page whose path contained `/storybook` (a component import path with `storybook/` in it, a component named `storybook`, a label value like it). It now skips the gate only for the published-Storybook routes, `/projects/<slug>/storybook` and below; every other project page redirects to the sign-in page as before.
