---
"@storyshelf/core": minor
---

Changed: the pull-request comment leads with one state, lists changed stories and links each

The comment opens with one headline (⏳ capturing, 🟡 changes need review, ✅ approved, ❌ rejected, ⚠️ capture failed, ⚪ cancelled, ⏭️ skipped; hosting-only projects get the review states), then the review, approve and Storybook links, a table of the first 10 changed stories (the rest in `<details>`) and a small footer with the commit, partial capture and update time. An approved build shrinks to one line. Each story links to its review page and to that story in the published Storybook through `index.html` (`UrlBuilder.storybookStory`, `storybookIndex`). The GitHub check run's summary shows the same Markdown. The body stays under 60,000 characters, truncating lists first. Reviewer names, failing tests, removed stories, a11y counts and earlier builds render when the caller supplies them (`BuildStateInput.extras`); wiring those reads is follow-up work.

Schema: none
