---
"storyshelf": minor
---

Added: upload names the older in-flight builds of a branch it replaces so the server can cancel them

Before creating a build, `storyshelf upload` asks the server for the branch's in-flight builds and sends the ones that git history says are replaced as `supersedes`: strict ancestors of the uploaded commit, and commits force-pushed away when the uploaded commit is the remote tip. Descendants, the same commit, and anything git cannot decide are kept. The project setting decides on the server; the step never fails an upload and sends nothing to a server that answers 404. Use `fetch-depth: 0` in CI to see ancestors.
