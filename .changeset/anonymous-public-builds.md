---
"@storyshelf/app": minor
---

Added: Anonymous visitors can view public builds and their diffs (ADR 0011)

With sign-in on, a visitor who is not signed in can open a project that has a public build (marked public, or on a branch matching `publicBranchRegex`): its builds list shows the public builds only, and each public build's review page and its screenshot, diff and baseline images open read-only, answered `private, no-cache`. A private build answers exactly like a missing one. The sign-in page links to the first such project. Comments, verdicts, capture logs, insights and design links stay for members, and every write still needs a session.
