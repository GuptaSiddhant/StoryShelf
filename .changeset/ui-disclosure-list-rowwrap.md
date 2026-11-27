---
"@storyshelf/app": patch
---

Fixed: one inline disclosure, no browser bullets, one tick, no wrapped separators or ragged rows

Page-level folds use `Disclosure variant="inline"` instead of the browser's triangle; the AI triage and health lists are stacked rows; decided snapshots show the check icon; a comment's time no longer starts a wrapped line with a dot; summary-list actions always sit under the text on a phone; and a build with nothing to compare shows its status above "Build details". Schema: none.
