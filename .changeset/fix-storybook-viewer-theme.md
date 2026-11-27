---
"@storyshelf/app": patch
---

Fixed: the Storybook viewer and its Preparing page follow the app theme and use the app's buttons

Both documents now carry the app's token stylesheet and saved light or dark choice, so opening a Storybook in dark mode no longer flashes a white bar. The bar uses the app's font, size, height and secondary small buttons, the crumbs use the same "›" separators and a mono sha, and the Preparing page is the app's waiting state with accent links instead of faded browser-blue ones. No route, header, sandbox attribute or polling behaviour changed. A ratchet bans hex colours and `font-family` literals in pages outside a `css` template.
