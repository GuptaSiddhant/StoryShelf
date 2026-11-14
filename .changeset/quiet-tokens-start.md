---
"@storyshelf/app": minor
"@storyshelf/core": minor
---

Added: first-run Get started card, copyable tokens and add member by email (#939)

A project with no builds now shows a "Get your first build" card on Library and Builds: create a token, copy the upload command (its `--url` is the confirmed public origin, or a placeholder), and the page moves on when the first build arrives. A new token shows Copy buttons and the upload command. Add member takes an email instead of a user ID (`UserModel.getByEmail`), and the zero-projects guide stops suggesting `storyshelf create` once a project exists.
