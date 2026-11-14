---
"@storyshelf/app": minor
"@storyshelf/core": minor
"@storyshelf/db-sqlite": minor
"@storyshelf/db-postgres": minor
"@storyshelf/db-mysql": minor
---

Security: a default-branch build counts only once the git host confirms its commit (#910)

Any upload token could name the default branch, so a pull request's CI job could auto-approve its own changes, replace the default-branch baselines and post a passing status. The capture job now asks the project's GitHub or GitLab channel whether the commit is on the default branch (a new `commitOnBranch` method on git providers). If the host says no or cannot answer, the build is reviewed like a feature branch, the status says why and the build page offers a re-check. **Breaking:** the new project setting `requireVerifiedDefault` is on for new and existing projects, so a project without a git channel stops auto-approving default-branch builds. Connect a channel, or turn the setting off in Settings → Tests for a project with no git host.
