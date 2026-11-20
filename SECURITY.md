# Security Policy

## Supported versions

StoryShelf is pre-1.0. Security fixes land on the latest released version (all workspace packages share one version). Please upgrade before reporting an issue you found on an older release.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub:

<https://github.com/GuptaSiddhant/StoryShelf/security/advisories/new>

Include affected package(s) and version, reproduction steps or a proof of concept, and the impact you expect.

## What to expect

- Acknowledgement within 5 business days.
- An assessment and a fix or mitigation plan, shared with you in the private advisory.
- A coordinated disclosure window of **90 days** from the report (sooner once a fix ships). We credit reporters in the advisory unless you prefer otherwise.

## Scope

In scope: the `@storyshelf/*` packages, the `storyshelf` CLI, the server scaffolds it generates, and the project's published Docker image and Terraform reference stacks.

Areas of particular interest:

- **`SECRET` handling.** The server `SECRET` signs sessions and is the key material for AES-256-GCM encryption of webhook secrets and git-provider tokens at rest. Any leak, weak derivation, or way to bypass it is in scope. Operators must set it to at least 32 random characters and rotate it deliberately, because rotating it makes existing encrypted rows unreadable.
- Authentication and authorization: roles, API tokens, `STORYSHELF_ADMIN_TOKEN`, OIDC/SAML/passkey flows.
- Upload and static serving of Storybook builds, including path traversal and stored XSS in published Storybooks.
- Server-side request forgery through webhooks or git-provider integrations.

Out of scope: vulnerabilities in third-party dependencies with no StoryShelf-specific exploit path (report those upstream), findings that need an already-compromised admin account, and denial of service by sheer volume.

## Known advisories

Dependency advisories that remain open on `main`, with the reason each is not reachable. The advisory text was not retrievable when this was written, so each entry rests on how the package is used, not on the advisory's description; recheck it against the advisory when upgrading.

The weekly audit (`.github/workflows/audit.yml`, #47) compares the live advisories with the tracked exceptions in `scripts/audit-exceptions.json`. Every entry in that file is one advisory on one target (`workspace`, `storybook-8`, `storybook-9`, `storybook-10`) with a `reviewBy` date and the issue it is tracked on (#335), and must be listed in the table below. The run fails on an advisory that is not an exception and on an exception past its `reviewBy` date, so a date is a deadline for the owner to re-review the entry, not an acceptance. Only the owner adds an entry or moves a date. Nothing is ignored by severity. Note that `nub audit` reads only the root importer, so it cannot stand in for the workspace audit; the workflow audits all of `nub.lock`. See `docs/testing.md`, "Dependency audit".

| Advisory                                                                                                                                                                    | Where                                                                                                                                                                  | Why it is not reachable                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uuid` 9 ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq))                                                                                         | Root lockfile: `@google-cloud/storage` 7 (`@storyshelf/storage-gcs`) via `gaxios` 6 and `teeny-request` 9. Also `fixtures/storybook-8` via `@storybook/addon-actions`. | The only calls are `uuid.v4()` with no arguments (a multipart boundary in `gaxios` and `teeny-request`; random ids in the addon). No caller passes a buffer or a name or namespace. `@google-cloud/storage` 8+ drops `uuid` but deprecates `keyFilename` and `credentials`; moving to `GoogleAuth` needs `google-auth-library` as a new direct dependency of the adapter, so the upgrade is a separate task. Fixture code only runs at Storybook build time, and the uploaded output is static files. |
| `@vitest/mocker` 3.2.4 ([GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)) | `fixtures/storybook-9` via Storybook 9.1                                                                                                                               | Pulled in by Storybook's own tooling, not by StoryShelf code. The fixture is an independent install that only runs `storybook build` on a developer or CI machine and never runs Vitest; the uploaded output is static files. Per #335, patched versions need a newer Vitest major than Storybook 9 allows.                                                                                                                                                                                           |

Fixed by upgrading (#335): `basic-ftp`, `extract-zip` and `zod` 3 left the root lockfile with `puppeteer-core` 25, whose browser downloader no longer depends on them.
