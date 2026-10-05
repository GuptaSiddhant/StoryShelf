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
