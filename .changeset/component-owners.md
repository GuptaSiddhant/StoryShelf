---
"@storyshelf/affected": minor
"@storyshelf/ai": minor
"@storyshelf/app": minor
"@storyshelf/auth": minor
"@storyshelf/core": minor
"@storyshelf/db-mysql": minor
"@storyshelf/db-postgres": minor
"@storyshelf/db-sqlite": minor
"@storyshelf/design-figma": minor
"@storyshelf/image": minor
"@storyshelf/mcp": minor
"@storyshelf/notify-chat": minor
"@storyshelf/notify-email": minor
"@storyshelf/notify-git": minor
"@storyshelf/observability": minor
"@storyshelf/runner-playwright": minor
"@storyshelf/runner-puppeteer": minor
"@storyshelf/storage-azure": minor
"@storyshelf/storage-gcs": minor
"@storyshelf/storage-local": minor
"@storyshelf/storage-s3": minor
"storyshelf": minor
---

Added: reviewers assigned from component ownership (#465, #437). A project admin can map story-file globs to project members on the Members tab (**Component owners**, one CODEOWNERS-style rule per line, a glob then member ids; an id that is not a member is refused and nothing is saved). When a build waits for review, the owners of the components it added or changed are its **assigned reviewers**: each gets one `review:requested` that says why ("You were asked to review this because you own ..."), even if they turned the default email off, and the build page lists them with where they stand. Assignment is advisory: approvals, verdict rules and statuses do not change, and any approver can still approve. With no matching owner, the default approvers are asked as before. `projects` gains a `component_owners` column on all three databases (added to existing ones on start).
