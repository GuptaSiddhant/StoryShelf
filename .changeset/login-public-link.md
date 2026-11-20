---
"@storyshelf/app": patch
"@storyshelf/core": patch
---

Added: optional `ui.auth.publicLink` puts a link to public content on the sign-in page

`ui.auth.publicLink: { href, label }` renders a secondary link under the sign-in form, for example to a public build's Storybook. `href` must be an `https:` URL or a path on the server; nothing renders when it is unset. The Fly demo sets it from `SHELF_AUTH_PUBLIC_LINK_URL` and `SHELF_AUTH_PUBLIC_LINK_LABEL`. The link grants nothing: public builds cover hosting and the Storybook preview, never review. Schema: none.
