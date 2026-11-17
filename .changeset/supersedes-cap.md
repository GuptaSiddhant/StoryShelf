---
"storyshelf": patch
---

Fixed: upload no longer fails when more than 50 older builds on the branch are still in flight

The server takes at most 50 ids in `supersedes`, and the CLI sent them all, so a branch with a
backlog of 51 or more unfinished builds failed every upload with a 400. The CLI now sends 50 and
says how many remain; each later upload cancels the next batch.
