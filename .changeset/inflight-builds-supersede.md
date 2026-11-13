---
"@storyshelf/app": minor
"@storyshelf/core": minor
---

Added: list a branch's in-flight builds and cancel superseded ones on build creation (ADR 0045, #760)

`GET /api/v1/projects/:slug/builds/in-flight?branch=` answers `{ id, sha }[]` for the branch's builds that are still working (`testing` class, same roles as build creation). `POST …/builds` accepts `supersedes: string[]` (at most 50); the server cancels each older in-flight build it names through `BuildModel.supersede`, which ignores another branch, another project, the same or a newer commit, and any build in review. A failure is logged and never fails the upload. The project API reads and writes `cancelSuperseded` (admins).

The writer is off by default: set `config.supersedeOnCreate: true` to act on `supersedes`, one minor release after this one (ADR 0053, readers first). Until then the list is accepted and ignored.
