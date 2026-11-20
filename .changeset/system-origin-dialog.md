---
"@storyshelf/app": patch
---

Changed: the System page's public origin opens its form in a dialog

Entering, confirming or changing the public origin now opens a dialog from the System page (`GET /admin/public-origin/edit`; a plain request gets a page of its own). Its POST routes, CSRF field, route class and flash-and-redirect answers are unchanged, and the form is not offered while the configuration or the platform fixes the origin. No schema change.
