---
"@storyshelf/core": patch
"@storyshelf/app": patch
"@storyshelf/notify-chat": patch
"@storyshelf/notify-git": patch
---

Security: refuse project-set URLs that point at private or local addresses

Webhooks, Slack and Teams channels and GitLab hosts must now use `https` and resolve only to public addresses. The check runs when a webhook is saved and again on every send, connects to the address it checked, and re-checks each redirect. Operators can allow exact internal hosts, or plain `http` in development, with `config.outbound` (`allowHosts`, `allowHttp`).
