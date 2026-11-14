---
"@storyshelf/app": minor
"@storyshelf/core": minor
---

Added: web push notifications for review requests, mentions and failures (ADR 0048).

Three routes, all class `hosting` and `404` without VAPID keys: `GET /api/v1/push/public-key`, `POST /api/v1/me/push-subscriptions` (register this browser; signed-in users only) and `DELETE /api/v1/me/push-subscriptions/:id`. `push` is now a `via` kind of a personal notification subscription: it stays off until the person registers a device and lists `push`, and then follows their event preferences. Review requests queue one `review-request` job per device on the `notify` queue (a device the push service reports gone is deleted, any other failure is retried); mentions and failures deliver inline like email. Nothing is sent without a confirmed public origin, and a push carries a title, a one-line body and a path, never an absolute URL. The service worker shows each push, opens only same-origin pages on click, and unsubscribes the device (and forgets its row) on sign-out.

Review follow-ups to the core notifier: the VAPID key pair is checked once at boot (a garbage or mismatched pair leaves push off with one error line instead of failing 403 at every push service), the private key is held only as a `KeyObject`, and VAPID tokens are cached per origin for three hours. `SHELF_VAPID_SUBJECT` is now required with the keys. Registrations are validated: an `https:` endpoint of at most 512 characters, a 65-byte `p256dh` starting `0x04` and a 16-byte `auth`. `ShelfOptions.notifications.vapid` enables push; the server image and dev server read it from `SHELF_VAPID_*`. `FormattedNotification` gains optional `summary` and `url`.

Schema: none.
