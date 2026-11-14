---
"@storyshelf/core": minor
"@storyshelf/app": patch
"@storyshelf/runner-playwright": minor
"@storyshelf/runner-puppeteer": minor
---

Internal: story switching inside one loaded page, built but not offered until ADR 0052's gate passes (#990)

Both runners can render a session of stories in one loaded `iframe.html`: the first story is a fresh load, later ones are reached with Storybook's `setCurrentStory`, settled on that story's own events, then network quiet and fonts. Anything uncertain (a failure, a play function, `parameters.storyshelf.isolate`, paused animations or videos, a document that no longer matches the one served) ends the session and the story loads a fresh page. Core sends `render` a `switchStories` request listing only the baselined story/viewport pairs, keeps a switched capture only when its bytes are the baseline's, and renders every other switched story again on fresh pages (decision 5).

Neither runner offers it yet (`metadata.switchStories: false`): the correctness gate passed, the speed gate did not, so `projects.switch_stories` keeps having no effect. Runner `render` input gains `switchStories`, `RenderedSnapshot` gains `switched`, and story parameters gain `isolate`. The mask style now starts with a marker comment; Puppeteer captures now carry `durationMs`. The operator veto reaches a forked capture child (`STORYSHELF_SWITCH_STORIES_VETO`).
