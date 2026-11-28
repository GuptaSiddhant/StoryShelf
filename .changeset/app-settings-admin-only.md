---
"@storyshelf/app": patch
"@storyshelf/common": patch
"@storyshelf/core": patch
---

Security: only admins see tokens, webhooks and integrations in settings, and webhook URLs are masked

The project settings pages rendered for every member, so a Viewer or Developer could read each webhook's full URL (an incoming-webhook URL is a secret), the API token names, the git links, the notification channels, the design credentials and the AI profile. The tokens, webhooks, git, design and AI sections now render, and their data is read, only for a project admin or a site admin; a Viewer still gets every tab and the sections it may read (members, labels, capture settings, its own notification switches). Webhook URLs are never shown in full, even to admins: the settings page and the webhook list and create answers in `/api/v1` give the origin and the last four characters of the path (`https://hooks.slack.com/…/abcd`), through the new `maskUrlForDisplay` in `@storyshelf/common/redact` (re-exported by `@storyshelf/core/utils`). The token and webhook API lists already answered admins only; a test now pins that for Viewers, Developers, site viewers and project tokens.

Schema: none
