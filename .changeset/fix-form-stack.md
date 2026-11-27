---
"@storyshelf/app": patch
---

Fixed: forms space their fields with one stack, so no field or card ends in a blank band

Every form with fields is now a `Form` (a grid, one step of gap) instead of a raw `<form>`, and `Field`, `CheckField` and `FormActions` no longer carry a margin of their own. That removes the doubled gap inside stacks and the blank band under the last field of a card. A card with an empty review list, or a profile card with no memberships, no longer ends in an extra band. Ratchets ban a margin on `Field` and a raw `<form>` around fields, and the Storybook smoke check fails a card whose last child ends more than 24 px above its bottom edge.
