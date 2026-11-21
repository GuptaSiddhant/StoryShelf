---
"@storyshelf/core": patch
---

Fixed: the demo viewer gets its password after a failed first run; flaky tests are not called merge-blocking

The Fly demo's viewer account is completed when an earlier boot left it without a password. The pull-request comment no longer says every failing Storybook test blocks the merge: a test of a story marked flaky does not. Built-in Slack, Teams and HTTP email senders no longer read the response body of a failed request, so it cannot reach a notifier outcome.
