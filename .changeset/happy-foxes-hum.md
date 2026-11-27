---
"@storyshelf/app": patch
---

Fixed: the Library's offline button shows its saved state and the page no longer throws on load

On load the page's offline script read the service worker's `{ ok, usage }` reply as if it were the usage itself, so a kept project's "Keep offline" button stayed unlabelled and the script threw. It now unwraps the reply the same way the button click does.
