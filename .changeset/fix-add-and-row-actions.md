---
"@storyshelf/app": patch
---

Fixed: a list's Add button sits in its title row, as a small secondary button

The Add of the member, group mapping, token, webhook, channel, design file, component mapping, git link and git connection lists is now a secondary small button at the end of the section's title row (`SectionTitle` takes `actions`), shown once the list has rows; the primary Add stays in the empty state, so a page has one primary button. The Storybook smoke check fails a story with a visible `<button>` that is not in the body's font, and ratchets ban a bare link as a row action and a primary button in a title row.
