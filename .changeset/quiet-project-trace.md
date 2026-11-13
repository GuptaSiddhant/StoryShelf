---
"@storyshelf/core": patch
---

Security: send no traceparent header to project-set destinations (#914).

Webhooks, chat webhooks and GitLab hosts a project configures no longer receive the W3C `traceparent` header, so StoryShelf's trace and span ids stay out of third-party hands. Operator-configured destinations still carry it when tracing is on.
