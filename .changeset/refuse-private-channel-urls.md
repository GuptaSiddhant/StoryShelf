---
"@storyshelf/core": patch
"@storyshelf/app": patch
---

Security: refuse private or local chat and GitLab URLs when a channel is saved

A Slack, Teams or GitLab channel that points at a loopback, link-local or private address is now refused when it is saved, with the same message the webhook form shows. The send-time check stays the real guard.
