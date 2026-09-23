---
title: Webhooks
description: Subscribe to StoryShelf events — HMAC-signed, per-project, with event filtering.
---

StoryShelf posts outbound webhooks per project — e.g. build started, approved, rejected, failed — so you can notify Slack, Linear, or a custom service without polling.

## Configure

In **Settings → Webhooks** or via API:

```sh
curl -X POST $SHELF/api/v1/projects/my-app/webhooks \
  -H "Authorization: Bearer $STORYSHELF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://hooks.example.com/shelf", "events": ["build.approved", "build.failed"], "secret": "whsec_..." }'
```

- `url` — HTTPS endpoint (must be reachable from the server).
- `events` — JSON array filter or `null` for all events.
- `secret` — HMAC secret; stored AES-256-GCM encrypted with server `SECRET`.

Manage via `GET /api/v1/projects/:slug/webhooks` and `DELETE`. See `POST /api/v1/projects/:slug/webhooks` in the OpenAPI.

## Delivery

- Payload is JSON `{ event, project: { slug }, build: { id, gitSha, gitBranch, status } }`.
- Header `X-StoryShelf-Signature: sha256=<hmac>` — verify with the shared `secret` (HMAC-SHA256 of the raw body).
- Retries: transient 5xx / network errors are retried with backoff; 4xx is not retried. Delivery logs are not yet exposed beyond capture logs — track separately if you need audit.

## Tips

- Use label filters in your receiver (`pr`/`mr` labels on the build) to route PR webhooks to the right channel.
- For local dev, expose a tunnel (e.g. `ngrok`) and point the webhook URL at it.
- Webhooks respect auth — creating them requires project `admin`.

## Related

- [Project settings](/guides/project-settings/) — where webhooks are managed
- [Builds & snapshots](/concepts/builds/) — statuses that trigger events
- [REST API](/guides/api/) — endpoint walkthrough
