---
"@storyshelf/core": minor
"@storyshelf/app": minor
---

Changed: new per-project git channels are refused; System › Git moves existing ones to repository links

Release N+1 of ADR 0054 (decision 8, #1124). The project settings and `POST /api/v1/projects/{slug}/notification-channels` no longer accept a GitHub or GitLab channel; the refusal points to the server's git connection and Project → Settings → Git. Existing channels keep posting unchanged.

System → Git lists every remaining per-project git channel with a one-click move: pick a connection on the same host (or, for a GitHub App channel, make its own App a connection), and after a coverage check the channel becomes an approved repository link with the same repository and status prefix, in one transaction, and its stored token or key is deleted. A failure leaves the channel unchanged. A GitHub token channel cannot become a connection: add a GitHub App connection first and move it to that.

Per-project git credentials are removed in 0.19.0 (#1125). A channel not moved by then stops posting, and a required check that stops posting blocks merges, so System, System → Git and the project's notification settings warn about every remaining channel. No schema change.
