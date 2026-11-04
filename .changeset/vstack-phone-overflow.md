---
"@storyshelf/app": patch
---

UI: a stack no longer grows wider than the screen. A vertical stack's single column was as wide as its widest child, so the Builds list, the Library component history and the empty Projects page scrolled sideways on a phone (by up to 460px at 375px); the column now fits the page and a wide table scrolls inside its own region. A code snippet that scrolls sideways now takes keyboard focus, so a keyboard can scroll it. (#584)
