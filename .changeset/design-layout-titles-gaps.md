---
"@storyshelf/app": patch
---

Fixed: card titles are h2, cards share one gap, profile forms and the Library meta line keep shape

A card's only title is now an h2 (Component owners, Create label type, Danger zone and the other h3-titled cards), and a check refuses an h3 that is a card's only title. Cards on a settings tab, a build page and the notification, design and Git tabs sit 16 px apart instead of a mix of 12 and 16. The profile "Display name" and password forms stop at 640 px, the Library header's counts and latest build use the page-header meta line, and an absolute or relative time never breaks across lines. Schema: none
