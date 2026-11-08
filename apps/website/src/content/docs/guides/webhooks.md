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
- `events` — JSON array filter or `null` for all events. Build events are `build:created`, `build:reviewing`, `build:approved`, `build:rejected`, `build:pending` (a verdict sent a build back to pending, for example when a rejecting reviewer rewrites to an approval and too few approvals remain) and `build:cancelled` (a user cancelled the build, see [Builds](/concepts/builds/); the payload is `{ buildId, status: "cancelled" }`). Review adds `review:requested` and `review:verdict` (see [Review](/guides/review/#events)). Every comment, whatever it is anchored to, raises one `comment:created` whose `data.scope` is `build`, `story` or `snapshot`. `design:changed` reports a linked design that changed after its baseline was approved (see [`design:changed`](#design-changes)).
- `secret` — HMAC secret; stored AES-256-GCM encrypted with server `SECRET`.

Manage via `GET /api/v1/projects/:slug/webhooks` and `DELETE`. See `POST /api/v1/projects/:slug/webhooks` in the OpenAPI.

## Delivery

- Payload is JSON `{ event, project: { slug }, build: { id, gitSha, gitBranch, status } }`.
- Header `X-StoryShelf-Signature: sha256=<hmac>` — verify with the shared `secret` (HMAC-SHA256 of the raw body).
- Header `X-StoryShelf-Event: <event>` — the event name, for example `comment:created`. `review:comment` keeps working as a filter (in a webhook's `events`, a notification channel or a subscription): it matches build and story comments, and the delivered event name is `comment:created`.
- A comment event carries `data.eventId`, the comment id, and a retried delivery repeats it. De-duplicate retries by that id.
- Retries: transient 5xx / network errors are retried with backoff; 4xx is not retried. Delivery logs are not yet exposed beyond capture logs — track separately if you need audit.

## Design changes

Sent when a linked design (Figma node) was modified after the baseline it is compared with was approved, or no longer exists. It is a normal subscribable topic, off unless you opt in through a webhook's `events` filter, a notification channel or your subscription. Without a public URL set or confirmed, nothing is sent (see [Notifications](/guides/notifications/)).

The event is sent once per design node and design version, by the first review or component page load that sees the change, even when several load at once. A change seen while notifications are paused is sent once they resume; nothing is replayed at boot. Designs fetched with a member's own connection (no project token) are not announced.

```json
{
  "event": "design:changed",
  "projectId": "01J...",
  "data": {
    "projectId": "01J...",
    "componentPath": "src/Button.stories.tsx",
    "figmaUrl": "https://www.figma.com/design/KEY/App?node-id=1-2",
    "change": "modified-after-approval",
    "designVersion": "2381947"
  },
  "timestamp": "2026-11-03T10:00:00.000Z"
}
```

- `change` is `modified-after-approval` or `deleted`.
- `designVersion` is the provider's version of the design (for a deleted node, the last version seen), or `null` when the provider reported none.

## Tips

- Use label filters in your receiver (`pr`/`mr` labels on the build) to route PR webhooks to the right channel.
- For local dev, expose a tunnel (e.g. `ngrok`) and point the webhook URL at it.
- Webhooks respect auth — creating them requires project `admin`.

## Related

- [Project settings](/guides/project-settings/) — where webhooks are managed
- [Builds & snapshots](/concepts/builds/) — statuses that trigger events
- [REST API](/guides/api/) — endpoint walkthrough
