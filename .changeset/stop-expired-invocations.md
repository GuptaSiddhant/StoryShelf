---
"@storyshelf/core": patch
---

Stop a job's work at its deadline instead of letting it keep writing next to its redelivery. After `testing.maxJobSeconds` an abandoned capture stops at its next attempt-log line or progress report and posts no snapshot, status or build state; publishing stops before each file it extracts or persists and leaves the shared scratch directory to the redelivery; a notify delivery writes no git status and records no outcome once its attempt expired.
