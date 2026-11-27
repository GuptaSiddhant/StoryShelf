---
"@storyshelf/app": patch
---

Fixed: form pages share one 640 px column, and cards, alerts and status lines no longer leave blank bands

The create-project page, the page a dialog form falls back to and Add a git connection now use one `FormPage` (a `form-page` layout in the shell): a 640 px column, a card, the submit button then Cancel. The sign-in and passkeys cards no longer end with an empty status line (`LiveStatus` takes no room until it has text), the warning above the App name field has a gap, the blocks on System and Git sit one gap apart instead of two, the comment boxes and the display-name input use the 640 px measure, a date in a page header stays on one line, and a disclosure body starts a full step under its header. A ratchet bans margin wrappers (`mt-1`, `mb-1`) in pages.
