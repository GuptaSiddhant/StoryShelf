---
"@storyshelf/app": patch
"@storyshelf/core": patch
"@storyshelf/auth": patch
---

Security fix: a database, storage or library failure inside a settings form, the project or label API, the public-origin form or the invite page no longer sends its internal text (driver messages, SQL fragments, file paths) to the browser or API client. Those handlers now answer with their generic text ("Failed to update", "Failed to create project", "Invalid origin", and so on) and log the original error. Refusals written for the user still reach them unchanged: a duplicate or reserved label type, an invalid public origin, an invalid capture target, the password policy and an invalid or expired invite. Core exports `UserFacingError` for code that refuses on purpose. Authors of an `Auth` adapter outside this repository: throw `UserFacingError` from `acceptInvite` for any refusal you want shown on the invite page (an invalid or expired invite, a password policy); a plain `Error` now reads "Invalid or expired invite" there. Adding a label type with a key the project already has is now refused with a clear message instead of a unique-index error.
