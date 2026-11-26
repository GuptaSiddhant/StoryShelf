---
"@storyshelf/app": patch
---

Fixed: buttons use the app font, and badges, dates and absent values read consistently

Form controls now inherit the page font (they were drawn in Arial), the dialog close button drops the browser padding, words no longer run into inline code on the tests settings page, and the inherited-share card hides when its ratio is not finite instead of printing "NaN%". Raw lower-case values in System and Review badges go through `statusLabel()`, AI panels and the offline device page show relative times instead of sliced ISO strings, and an absent value or unset limit renders as one dash (or "not set"). A ratchet bans date slicing and raw `value`/`state`/`method` badge labels in pages.
