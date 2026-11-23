---
"@storyshelf/app": minor
---

Added: StoryShelf can be installed as an app (ADR 0048).

The app serves `GET /manifest.webmanifest` (class `hosting`, no session) with standalone display, theme colours from the theme tokens and 192 px, 512 px and maskable icons from the brand mark. The document head links it and sets light and dark `theme-color`. Schema: none.
