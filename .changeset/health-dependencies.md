---
"@storyshelf/core": minor
"@storyshelf/auth": minor
"@storyshelf/app": minor
---

Added: the admin health page shows AI, OIDC providers, telemetry, image engine and public origin

The System page and `POST /api/v1/health` (site admins only) gain more of what an operator depends on.

- **Probed rows:** the AI surface through its free `health()` (never a billed call), and each OIDC login provider's discovery document, within the existing 2 s probe timeout. A failure degrades the status like any adapter.
- **Status rows** (new `statuses` array, never change `status`): telemetry export on or off with the exporter origin only, the image engine and diff worker count, whether the public origin is confirmed (and why not), and the Storybook hosting mode with its content host.
- **Core and auth:** `AdapterSetupSources` gains `ai` and `authProviders`, `Auth` an optional `providerChecks()`, and `@storyshelf/core/diff` exports `imageEngineState()`.

The public `GET /api/v1/health` keeps its shape and makes no new outbound call. Rows carry no secret, header or URL beyond an origin. There is no schema change.

Schema: none
