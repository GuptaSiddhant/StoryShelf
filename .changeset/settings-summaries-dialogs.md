---
"@storyshelf/core": patch
"@storyshelf/app": patch
---

Changed: project settings list what is configured and open forms in dialogs

General, review, members, group mappings, API tokens, webhooks, notification channels, design files, component mappings and design tokens are now summaries (name, state, short details, actions) with Add and Edit in a dialog (ADR 0012, decision 10). Each form keeps its URL, CSRF field, route class and `hx-post` behaviour; the new form routes (`…/new`, `…/edit`) answer an HTMX request with the form and a plain request with a page of its own. A message channel's kind is a choice (`OptionFields`) and shows only its own field; message channels can now be edited, with a blank webhook URL keeping the stored one (`NotificationChannelModel.update`). The git channel form is unchanged (ADR 0054 replaces it). No schema change.
