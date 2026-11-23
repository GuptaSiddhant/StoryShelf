---
title: Web push notifications
description: Enable browser push for review requests, mentions and failures, generate VAPID keys, set the server variables and handle the iOS install requirement.
---

Web push delivers a personal notification to a browser or installed app, next to email. The design is [ADR 0048](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0048-installable-app-offline-push.md), section 4.

## What you get

Push is a personal delivery kind, like **Email me**: `push` is a `via` kind of a [personal notification subscription](/guides/notifications/). It stays off until you register a device and list `push` in a subscription's `via`. It then follows that subscription's event preferences. Review requests, mentions and build failures are delivered. A push carries a title, a one-line body and a path on this server. It never carries tokens or an absolute URL, and nothing is sent while the server has no [confirmed public URL](/guides/config/#public-origin).

## Operator setup

Push needs a VAPID key pair (RFC 8292) and a contact address. Without both keys push is off: its routes answer 404 and nothing is sent.

1. **Generate a key pair once.** Any VAPID generator works, or Node:

   ```sh
   node -e "
   const { generateKeyPairSync } = require('node:crypto');
   const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
   const pub = publicKey.export({ format: 'jwk' });
   const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
   console.log('SHELF_VAPID_PUBLIC_KEY=' + raw.toString('base64url'));
   console.log('SHELF_VAPID_PRIVATE_KEY=' + privateKey.export({ format: 'jwk' }).d);
   "
   ```

   The public key is an uncompressed P-256 point and the private key is its 32-byte scalar, both base64url.

2. **Set three variables:**

   | Variable                  | Value                                                                                         |
   | ------------------------- | --------------------------------------------------------------------------------------------- |
   | `SHELF_VAPID_PUBLIC_KEY`  | the public key (safe to expose)                                                               |
   | `SHELF_VAPID_PRIVATE_KEY` | the private key (a secret)                                                                    |
   | `SHELF_VAPID_SUBJECT`     | a contact the push services can reach, `mailto:ops@example.com` or `https://…`; always needed |

   With both keys set and no subject the server refuses to start. A pair that does not match is detected at boot: push stays off and one error line says why.

3. **Keep the private key secret.** Store it with your other secrets. StoryShelf never writes it to logs, errors, API output or the database. Only the public key is served, at `GET /api/v1/push/public-key`.
4. **Do not rotate casually.** A device's subscription is tied to the public key that created it, so a new pair means each device must register again.

Never commit a real key, and never paste one into an issue or a chat.

## Turn on push on a device

Each person turns push on per device, on **Profile → This device** (`/profile/offline`), in the **Push notifications** card. The card is hidden while the server has no VAPID keys.

1. Optionally name the device ("Work laptop"), then choose **Enable push on this device**. The browser asks for permission only on that click, never when the page loads.
2. The card lists your devices with their name and last delivery, and marks the one you are using. **Remove** turns push off for a device.
3. If you blocked notifications for this site, the card says so: allow them in the browser's site settings and try again.

Then list `push` in a [notification subscription](/guides/notifications/) for the projects you want pushed.

## Register a device through the API

The settings page uses these routes, and a script can too. A browser subscribes with the public key from `GET /api/v1/push/public-key`, then registers itself as the signed-in user:

- `POST /api/v1/me/push-subscriptions` with the browser's `PushSubscription` JSON (`endpoint`, `keys.p256dh`, `keys.auth`) and an optional `label`. The endpoint must be `https:` and at most 512 characters. Registering the same endpoint again replaces its keys, owner and label.
- `DELETE /api/v1/me/push-subscriptions/:id` removes a device.

A device whose push service answers 404 or 410 is removed automatically, and signing out unsubscribes the device and forgets its row. Clicking a notification opens a page on this server only.

## iOS

The settings card repeats this: on iPhone and iPad, web push works only for an app **installed to the Home Screen**, on iOS 16.4 or later. Open StoryShelf in Safari, choose **Share → Add to Home Screen**, then open it from the Home Screen icon. See [Install the app](/guides/installable-app/).

## Privacy

Push services (Apple, Google, Mozilla) see that a message was sent and to which endpoint, but not its contents: the payload is encrypted to the device (RFC 8291).
