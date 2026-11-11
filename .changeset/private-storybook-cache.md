---
"@storyshelf/app": patch
---

Security: private Storybook files are no longer publicly cacheable (#923)

A signed-in viewer's private build was answered as `public, max-age=31536000, immutable`, so a shared cache could serve it to anyone. Those answers are now `private`; public builds and signed URLs are unchanged.
