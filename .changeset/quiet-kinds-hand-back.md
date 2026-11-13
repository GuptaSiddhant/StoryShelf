---
"@storyshelf/core": minor
---

Changed: a queue consumer claims only the job kinds it handles and hands back newer payloads (#984)

The database queue now claims only the kinds the consumer has a handler for, so an older copy running beside a newer one never takes (and fails) a job kind it does not know. Every job payload carries a version `v` (1 for rows written before this); a consumer meeting a higher version than its handler reads (`KindHandler.payloadVersion`) hands the job back through the new `handBack` queue method, without spending an attempt. This is ADR 0053, decision 5.
