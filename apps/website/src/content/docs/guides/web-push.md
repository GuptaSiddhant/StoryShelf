---
title: Web push notifications
description: Enable browser push for review requests and other events, generate VAPID keys, set the server variables and handle the iOS install requirement.
---

Web push delivers a personal notification to a browser or installed app, next to email. The design is [ADR 0048](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0048-installable-app-offline-push.md), section 4.

:::note[Status]
**Planned.** Nothing on this page has landed yet. The `push_subscriptions` table is #843, the push notifier is #844, delivery, the API and the worker handlers are #845, and the settings page is #846. Everything below is written from the ADR; check each marker when its task merges, in particular the exact variable names.
:::

## What you get

Push is a personal delivery kind, like **Email me**. It is off until you enable it on a device, and it follows the event preferences you already have (review requested, mentions, change requests, build failed, and so on). A push carries only a title, a one-line body and a link to a page on this server. It never carries tokens or more than one line of a comment.

Nothing is sent while the server has no [confirmed public URL](/guides/config/#public-origin), the same as every other notification.

## Operator setup (planned: #844, #845)

Push needs a VAPID key pair (RFC 8292) and a contact address. Without keys push is off, its routes answer 404 and the settings page hides it.

1. **Generate a key pair once.** Use any VAPID generator you trust, or Node:

   ```sh
   node -e "
   const { generateKeyPairSync } = require('node:crypto');
   const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
   const pub = publicKey.export({ format: 'jwk' });
   const prv = privateKey.export({ format: 'jwk' });
   const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
   console.log('public :', raw.toString('base64url'));
   console.log('private:', prv.d);
   "
   ```

2. **Set the variables** from the environment: the public key, the private key and a contact `subject` (a `mailto:` or `https:` address the push services can reach). The names are fixed by #845 and are **not yet confirmed** here; this page will show them once that task merges.
3. **Keep the private key secret.** Store it with your other secrets, as you do `SECRET`. StoryShelf never writes it to logs, errors, API output or the database. Only the public key is exposed, at `GET /api/v1/push/public-key`.
4. **Do not rotate casually.** A device's subscription is tied to the public key that created it. Changing the key pair means each device must enable push again.

Never commit a real key, and never paste one into an issue or a chat.

## Enable it on a device (planned: #846)

Open your profile's notification settings and enable push on this device. The browser asks for permission, the device registers (`POST /api/v1/me/push-subscriptions`) and you can remove it later (`DELETE /api/v1/me/push-subscriptions/:id`). A device whose push service answers 404 or 410 is removed automatically. Signing out unsubscribes the device first.

Clicking a notification opens a page on this server only.

## iOS

On iPhone and iPad, web push works only for an app **installed to the Home Screen**, on iOS 16.4 or later. Open StoryShelf in Safari, choose **Share → Add to Home Screen**, then open it from the Home Screen icon and enable push there. See [Install the app](/guides/installable-app/).

## Privacy

Push services (Apple, Google, Mozilla) see that a message was sent and to which endpoint, but not its contents: the payload is encrypted end to end to the device (RFC 8291).
