---
"@storyshelf/core": minor
"@storyshelf/app": minor
---

Changed: projects are offered only the integrations the server can deliver

A provider may declare `availability()`; the built-in email notifier is unavailable until a transport (`SMTP_HOST`, `SMTP_FROM` or your own sender) replaces it. Project settings, the channel API and the form show and accept only available kinds; creating a channel of another kind answers 400 with the reason. A stored channel of such a kind is kept, hidden from its project and not delivered to, and the System page lists it under Integrations with every integration's state (available, unavailable with the reason, or turned off); the site-admin `POST /api/v1/health` reports the same under `integrations`. Site admins see one line in a project's settings naming what is missing. The new `SHELF_INTEGRATIONS_DISABLED` variable (`integrationsFromEnv` in `@storyshelf/core/integrations`) turns kinds off without code, e.g. `slack,teams,figma`; the server image and the Fly demo read it, and an unknown kind stops startup.
