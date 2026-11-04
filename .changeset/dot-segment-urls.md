---
"@storyshelf/core": patch
"@storyshelf/app": patch
---

Fixed: links to a component whose import path has a `.` or `..` segment (such as `../ui/Button.stories.tsx`) and to a label value with one now open the right page. A browser resolves such a segment before the request, so `UrlBuilder` gives these values the query form of the same page (`?path=` for components, `?value=` for labels), which the pages accept next to the path form. All other links keep their form.
