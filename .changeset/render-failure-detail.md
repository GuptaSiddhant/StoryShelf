---
"@storyshelf/common": patch
"@storyshelf/core": patch
"@storyshelf/runner": patch
---

Fixed: a failed story render is stored with its error name, render step and redacted cause chain

A remote render that failed was logged as just `UnknownError`: the attempt log kept only an `Error`'s message, so the name, the cause and the step that threw were lost. A render failure now reads `screenshot: UnknownError (caused by …)` in `RenderResult.failures[].error`, and the attempt log and the runner's log line carry the same `{ name, message, step, causes }`. Every string has the connection's endpoint, headers and lease scrubbed (`scrubConnection`), then `redactSecrets`, and is capped. The shared formatter is `failureDetail`/`failureText` in `@storyshelf/common/errors`. Schema: none.
