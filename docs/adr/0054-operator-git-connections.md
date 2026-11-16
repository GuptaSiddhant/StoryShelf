# ADR 0054: Operator Git Connections and Approved Repository Links

## Status

Proposed. The owner chose the direction on 2026-11-16: git provider setup belongs to the operator
(site admins), project owners only name or pick a repository, and a link posts nothing until a site
admin approves it. Amends ADR 0014 decisions 1 and 4. Statements marked `[inferred]` were not read
in the code and must be confirmed by the implementation.

## Context

Today every project sets up its own git channel (ADR 0014, decision 1): a project admin creates a
GitHub App or a token on the git host, then pastes the App ID, installation ID and private key, or
the token, into **Project → Settings → Notifications**. Connecting the demo on 2026-11-16 took about
ten steps on GitHub and three copied values. The work falls on whoever owns the project, once per
project, although the App and its key could serve the whole server.

Pasting the credential also proves something nobody wrote down: a project admin who can paste a key
that writes to `acme/widgets` controls `acme/widgets`. A server-wide credential removes that proof.
`storyshelf upload --sha` lets the uploader name any commit, so once a project is linked to a
repository, its builds post `storyshelf/testing` on that repository. If any project admin could link
any repository a server-wide connection reaches, one team could post a green merge gate on another
team's repository. The link is therefore the security boundary, not the credential.

Facts read in the code on 2026-11-16:

- Channel secrets are stored encrypted with the server `SECRET` in `notification_channels`
  (`secretEncrypted`). Secret rotation re-encrypts a fixed list of tables
  (`packages/core/src/models/credentials.ts`); a new credential table must join that list.
- In `checks` mode the private key is the channel secret and must never appear in config, logs,
  errors or API output (AGENTS.md, Git state).
- Session cookies are `SameSite=Lax` (`packages/app/src/middleware/same-site-writes.ts`), so a
  browser returning from the git host by a top-level `GET` still carries the session.
- StoryShelf receives no webhooks from git hosts; the App setup turns them off.

## Decision

### 1. Git connections belong to the server, set up by site admins

A **git connection** is a server-wide credential for one git host account, kept in a new table
`git_connections` (provider, display name, API base, non-secret config, encrypted secret, created
by, state). Only site admins create, rotate or delete one, on the System page's **Git** section.
A server may hold several: a personal GitHub App, an organization's App, a GitHub Enterprise Server
App, a GitLab group.

- **GitHub App, created from a manifest.** **Connect GitHub** posts an App manifest to GitHub, for
  the admin's account or a named organization (`/organizations/<org>/settings/apps/new`), with the
  permissions ADR 0014 needs: Checks and Pull requests read and write, Contents read, `public:
false`. The manifest must name a webhook URL; it points at a path on the server that answers 404,
  with `hook_attributes.active: false`. GitHub returns to StoryShelf with a one-time code, valid for
  an hour, which the server exchanges for the App ID and private key. Nobody copies a key. The
  exchange also returns a webhook secret and client credentials, which are discarded unused. The
  site admin then installs the App on the repositories they choose. `[inferred]` The same flow on
  GitHub Enterprise Server under its own base URL; GitHub's manifest documentation does not say.
- **An existing GitHub App, entered by hand.** A site admin who manages their own App (or rotates
  a key) enters its App ID and private key once for the server. This is also how today's
  hand-made per-project Apps move to a connection (decision 8).
- **GitHub connections are Apps only.** There is no GitHub token connection (owner, 2026-11-16).
  A token belongs to a person, expires (a fine-grained token within a year, often sooner by
  organization policy), needs the broad `repo` scope to comment, and cannot post check runs. When
  its owner leaves, every required check it served stops posting and blocks merges. An organization
  that does not allow the manifest flow creates the App by hand and uses the path above, which also
  covers GitHub Enterprise Server.
- **GitLab connections are tokens, of the bot kinds only.** GitLab has no App equivalent, and its
  OAuth applications act as a user. A connection takes a **group or project access token** (a bot
  user, not a person), with the `api` scope, never a personal access token. The System page opens
  GitLab's form for that token with the name and scope filled in, records the expiry the admin
  enters, and warns site admins 30 days before it. `[inferred]` GitLab accepts those prefill
  parameters in the form's URL; if not, the page shows the scope to pick instead.

Every secret a connection holds (a private key or a GitLab token) is stored
encrypted with `SECRET`, never returned by the API or shown again, and removed from logs and error
text through the existing redaction. `git_connections` joins the rotation list in
`credentials.ts`, so `SECRET_PREVIOUS` and the re-encrypt action cover it.

### 2. Projects link a repository, and a link is pending until approved

A project admin connects a project to a repository on **Project → Settings → Notifications** by
pasting its URL. The result is a **repository link** (a new table: project, connection,
owner/repo, the host's repository ID, prefix, mode, state, requested by, approved by).

A project admin never sees what a connection can reach. While the operator switch (below) is off,
the form takes a URL only and gives the same answer whether or not the repository exists or is
covered, so it cannot be used to list or probe other teams' private repositories. Coverage is
checked when a site admin approves the link, and shown to the site admin. The picker (the GitHub
installation's repositories, the GitLab group's projects) appears only when the switch is on.

- A new link is `pending`. A pending link posts no status, no check run and no comment, and the
  project page says it waits for a site admin.
- A site admin approves or refuses it on the System page, or creates the link already approved
  (assigning a repository to a project up front). Approval records who approved it and when, and
  the host's numeric repository ID, so a repository renamed or deleted and re-created under the
  same name is not reached by the old approval.
- Changing an approved link's repository, connection or prefix returns it to `pending`.
- Approving a link re-requests the state of the project's open builds, as confirming a public
  origin does, so open pull requests get their check without waiting for the next push.
- **Operator switch:** `site_settings` holds "project admins may link any repository a connection
  covers" (default off). With it on, a link a project admin creates is approved at once: the
  one-click flow for a server whose project admins are all trusted with every repository the
  connection reaches. Turning it off does not revoke existing links.
- Removing a link, deleting a connection or refusing a link stops delivery for that project; a
  refused link keeps its record for the audit trail.

### 3. One gate per repository and prefix

A repository link is unique per (connection host, repository, prefix), counting the per-project
git channels that remain during the move (decision 8). A second project on the same repository
must use its own prefix (ADR 0014's "several projects in one repo"), so it can never
overwrite another project's `<prefix>/testing` or `<prefix>/review`. The link form proposes a
prefix derived from the project slug when the default is taken.

### 4. The installation is resolved, never taken from a URL

GitHub returns from an installation with `installation_id` in the query string. Anyone can craft
that URL, so it is never stored. For each linked repository the server asks GitHub, with the App's
own credentials, which installation covers `owner/repo`, and caches the answer with the link. A
repository the App is not installed on cannot be approved; the form says so and links the App's
install page.

### 5. Return pages from the git host

The manifest exchange and the installation return are cross-site `GET`s.

- Each flow starts from a site-admin form post that stores a single-use `state` (random, bound to
  the session, ten-minute life). The return page checks it and shows a confirm page; the write is a
  CSRF-protected form post (`CSRF_PATHS`), never the `GET` itself.
- Redirect and return URLs are built only from the confirmed public origin
  (`createPublicOriginResolver`). With none confirmed, the flow refuses to start and the page says
  why.
- The routes are classified `hosting` (git delivery works with testing off) and sit under the
  site-admin pages. They hold no token in a URL beyond the one-time `code` and `state`, which are
  never logged.
- In `subdomain` mode the return must reach the portal origin, where `__Host-storyshelf_session`
  lives (ADR 0051). `[inferred]` That cookie is sent on the top-level return navigation; the
  implementation confirms it in a browser test.

### 6. No webhooks

StoryShelf still receives nothing from git hosts. It learns that an App was uninstalled, a token
revoked or a repository removed only from a refused write. A refusal can also be about the commit:
`--sha` is chosen by the uploader, and a commit that is not in the repository is refused too. So a
401, 403 or 404 alone never breaks a link. On a refusal the handler checks the link itself (the
installation still covers the repository ID, or the token can still read it). Only when that check
fails is the link marked `broken` with the reason, and the System page and the project's settings
show it with a reconnect action. Otherwise the job fails and retries as today. No new job kind and
no new build status are added (ADR 0053).

### 7. Delivery is unchanged

Statuses, check runs and the pull-request comment keep ADR 0014's rules: one mapper, durable
latest-wins delivery, a confirmed origin before anything is sent. Only where the credential comes
from changes: the `notify` handler reads the link, then its connection, instead of a channel
secret.

### 8. Moving off per-project credentials (ADR 0053)

- **Release N:** add `git_connections` and the repository links (expand). Existing per-project git
  channels keep working unchanged. The project settings offer linking when a connection exists, and
  per-project credentials only when none does.
- **Release N+1:** new per-project git channels are no longer accepted. The System page lists the
  remaining ones with a one-click move: the site admin creates or picks a connection, and the
  channel becomes an approved link. A per-project GitHub token channel cannot move as it is: its
  site admin creates an App connection first, and the release notes of N and N+1 say so.
- **Release N+2 or later:** per-project git credentials are removed (contract), one minor after the
  last release that read them. A channel nobody moved stops posting then, and a required check
  that stops posting blocks merges. So from N+1 the System page and the project's settings warn on
  every remaining channel, with the release in which it stops, and the release notes say so.

Chat, email and push channels stay per project; this ADR covers git hosts only.

### 9. Connections and links can come from configuration

The UI flow suits a server set up by hand; a server deployed from code (the Terraform modules of
ADR 0050, identical copies, recovery) needs the same result without clicks. So a connection can also
be declared:

- In code, as `createShelfApp({ git: { connections, links } })`, with constructors in
  `@storyshelf/core/integrations` (`githubApp({ id, appId, privateKey, apiUrl? })`,
  `gitlabGroup({ id, host, token, expiresOn })`).
- In the server image's environment, through `gitFromEnv(env)` beside `smtpPresetFromEnv`: one
  GitHub App (`SHELF_GITHUB_APP_ID`, `SHELF_GITHUB_APP_PRIVATE_KEY` or `…_FILE`,
  `SHELF_GITHUB_API_URL`) and one GitLab connection (`SHELF_GITLAB_HOST`, `SHELF_GITLAB_TOKEN` or
  `…_FILE`, `SHELF_GITLAB_TOKEN_EXPIRES`); more through `SHELF_GIT_CONFIG_FILE`, a JSON file of the
  same shape. The Terraform modules pass the key from the cloud's secret manager, never as plain text.

Rules:

- A configured connection has a stable `id`, which links refer to across restarts. Its secret is read
  at startup and never written to the database; rotation is a secret change and a restart.
- The System page shows it as **managed by configuration**: state, health and coverage, no Edit or
  Remove. A database connection with the same `id` is ignored, and the page says so.
- Links in configuration count as approved, follow decision 3, and show as managed. Other links are
  requested and approved in the UI as in decision 2.
- Removing a connection from configuration marks its links `broken` (decision 6) instead of
  deleting them, so restoring it restores them.

### 10. What StoryShelf reads and posts

**Reads are fixed and minimal.** A connection reads which pull request contains a commit, the pull
request's comments (only to find its own), which installation covers a repository, and the
repository's numeric ID. It never reads code, diffs or files: captures come from the uploaded
Storybook (ADR 0004), not the git host. The docs and the System page say so.

**Posts have two layers of choice.**

- **The operator sets the ceiling** through the connection's permissions. Checks write (the merge
  gate) is required. Pull requests write (the comment) and commit statuses write (plain statuses
  instead of check runs) are optional checkboxes in the manifest flow. The System page shows what
  each connection may post. A GitLab token's `api` scope allows everything, so its ceiling is a
  per-connection setting instead.
- **Project admins choose within the ceiling, per link:**
  - the merge gate (`<prefix>/testing` or `<prefix>/review`): always on while the link exists;
  - the Storybook status (`<prefix>/storybook`): on or off, default on;
  - the pull-request comment: `always`, `on-changes` or `off`, default `always`;
  - per-snapshot annotations on the check run: on or off, default on.

  Options above the ceiling show as unavailable, with the reason. The settings sit on the link (its
  edit dialog, ADR 0012 decision 10) and are stored with it.

The gate cannot be switched off on a linked repository: branch protection that requires a check
which never arrives blocks every merge. A project that wants no gate removes the link.

## Consequences

- Setup moves to the person who runs the server, once per git host account; a project owner pastes
  a URL or picks a repository.
- Each server has its own GitHub App. A single public App shared by every server would need its
  private key on every server, which would let any operator write to every repository that
  installed it; making it safe needs a relay service holding the key, a central dependency the
  self-hosted workflow avoids. An optional hosted relay could be a separate, opt-in decision later.
- A team that used a GitHub token per project must create an App to keep its gate.
- No project admin can make a merge gate appear on a repository a site admin has not approved for
  that project, unless the operator switches that check off.
- A server-wide key reaches every repository its App is installed on. The installation list on the
  git host and the approved links are the two places to review, and both are visible to site
  admins.
- A broken connection now affects every project linked through it. The System page shows each
  connection's state, and its health appears with the other dependencies (#1090).
- Proving control automatically, for example with a CI identity token (GitHub Actions or GitLab CI
  `id_tokens`) that names the repository, could replace the site admin's approval later. It is left
  out: it adds inbound trust surface, and fork pull requests and self-hosted issuers need their own
  rules. It would be an amendment to this ADR.
- Buttons and `/storyshelf` commands in pull requests still need inbound webhooks and are not part
  of this ADR.

## References

- ADR 0011 (roles), ADR 0014 (git hosts and notifications), ADR 0051 (cookies and origins), ADR 0053
  (migrations).
- GitHub: creating an App from a manifest, and the App installation endpoints for a repository.
- Issues: #1111 (one comment per project), #1112 (the comment's content).
