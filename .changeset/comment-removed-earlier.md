---
"@storyshelf/core": minor
---

Added: the pull-request comment lists removed stories and earlier builds

A delivery now diffs the baseline build's catalog against this build's and lists the stories that are gone (the newest approved build before this one on its branch, else on the default branch; nothing while either catalog cannot be read). It also links the project's earlier builds on the same branch, newest first, at most 10, each with a fixed state phrase and a link from the confirmed origin. Story names are escaped.

Schema: none
