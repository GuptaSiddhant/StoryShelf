---
"@storyshelf/app": patch
---

Changed: the build review snapshot list is denser and grouped by component

Rows are 44 px with a small thumbnail, the story name, and a status dot with the diff percentage on the right (the dot has a hidden text label). The component title is shown once as a group header instead of under every row, and "(chromium)" is dropped when the build has one browser. Reviewed rows are muted with a check. On narrow screens the header stays visible as a label ahead of its rows.
