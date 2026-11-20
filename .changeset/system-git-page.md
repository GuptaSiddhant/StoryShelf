---
"@storyshelf/core": minor
"@storyshelf/app": minor
---

Added: System → Git, where site admins connect GitHub or GitLab once and approve repository links

Site admins add a server-wide git connection on System → Git (`/admin/git`): **Connect GitHub**
creates a private App from a manifest (for an account or an organization, on github.com or GitHub
Enterprise Server, with the comment and plain statuses as optional permissions), an existing App
takes its App ID and private key, and a GitLab group or project access token takes a prefilled link
to GitLab's form plus its expiry. The manifest flow refuses to start without a confirmed public
origin; it issues a random, session-bound, single-use `state` that lives ten minutes
(`GitSetupStateModel`, kept hashed in `site_settings`), GitHub's return only shows a confirm page,
and a CSRF-protected post exchanges the one-time code and stores the private key encrypted. The
page lists each connection with its account, linked repositories, health, token expiry, what it
may post and whether configuration manages it; lists pending and broken links with their coverage,
to approve, reconnect or refuse; and holds the operator switch. Keys, tokens, codes and states never
appear in HTML, logs or errors (epic #1117, ADR 0054).
