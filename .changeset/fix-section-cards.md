---
"@storyshelf/app": patch
---

Fixed: every settings section is a card with its title and description inside it

General, Review, Members and group mappings, API tokens, Webhooks, Channels, Design files, Component mapping and Design tokens were headings on the page background with their description outside any card, next to sections that were cards. Each is now a `Card` whose first child is the section title, and a ratchet bans a section title (h2) outside a card in pages.
