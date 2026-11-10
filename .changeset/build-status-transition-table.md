---
"@storyshelf/core": patch
"@storyshelf/app": patch
---

Changed: a build's status moves along one explicit transition table, enforced at the write

`packages/core/src/lifecycle/build-lifecycle.ts` lists every move a writer makes, the terminal states and the named exits (retry, a verdict, the snapshot rollup). `BuildModel` writes a status only `WHERE status IN (the states that may move to it)`, so a stale worker, a redelivered job or a late verdict can no longer move `approved` back to `capturing` or `failed` to `reviewing`; a refused write returns the row as it is. `TERMINAL_BUILD_STATUSES`, `CANCELLABLE_BUILD_STATUSES` and the new `OPEN_BUILD_STATUSES` are derived from the table. A status derived from verdicts is fenced on the newest verdict row it was computed from and recomputed on refusal, so a delayed approval never overwrites a later rejection. A snapshot approval on a `failed` build no longer turns it `approved` or `reviewing`, and a cancel that loses a race with a verdict answers 409.
