---
"@storyshelf/app": patch
---

Fixed: a read-only role sees no review controls, and a 403 says why

A Viewer no longer sees Approve, Reject or the comment box on the review pages (they failed with 403); one line says the role is read-only. The pages take the viewer's rights from the server's `reviewCapabilities`. A 403 now toasts "Your role cannot do this.", a 429 its own line, and every other failure keeps the generic message.

Schema: none
