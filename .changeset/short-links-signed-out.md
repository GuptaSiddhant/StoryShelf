---
"@storyshelf/app": patch
---

A short link (`/_/<build id or project slug>/`) to a public build now opens for a visitor who is not signed in, instead of sending them to the sign-in page first (ADR 0011). A private build and an id that does not exist both answer with the sign-in redirect, so a short link never confirms that a private id exists.
