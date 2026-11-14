---
"@storyshelf/app": minor
---

Added: a "Cancel superseded builds" switch on the Capture settings tab and a superseded build page (#762).

The Capture tab has a new Superseded builds card with the project's `cancelSuperseded` switch (on by default, per ADR 0045; admins only). A build a newer commit replaced shows "Nothing to review: this build was superseded by <short sha>" on its page, linking to the newer build, with no retry in the card. The builds list still shows it as cancelled.
