---
"@storyshelf/app": minor
---

Added: manage push notifications per device (ADR 0048).

The "This device" page gains a push card: "Enable push on this device" (the browser asks for permission only on the click), the signed-in person's devices with label and last delivery, and "Remove". It is hidden when the server has no VAPID keys. A short note says push on iPhone and iPad needs the app installed to the home screen.

Schema: none.
