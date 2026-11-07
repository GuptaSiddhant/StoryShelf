---
"@storyshelf/app": patch
---

A cancelled build now shows no verdict controls on its review card, the same as a failed one (a cancelled build is terminal). The capture progress bar sets its fill width through a class instead of an inline style, and the UI consistency check now also scans `src/ui/` for inline styles.
