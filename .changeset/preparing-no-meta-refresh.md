---
"@storyshelf/app": patch
---

Fixed: the Storybook "Preparing" page no longer reloads itself with a meta refresh

The page now checks again every 5 seconds in a script, announces its state in a polite live region, lets visitors pause and resume the automatic check, and stops after 60 checks (5 minutes) and says so. "Check again" is a plain link that works without JavaScript. This clears the axe `meta-refresh` finding (WCAG 2.2.1).
