---
"storyshelf": minor
---

Added: `storyshelf protect --provider github` understands repository rulesets. When a ruleset applies to the branch, it confirms the required StoryShelf check there, and with `--apply` adds it to the repository ruleset that already has a status-check rule or creates a "StoryShelf merge gate" ruleset; with no ruleset it uses classic branch protection as before. The output says which mechanism it used, including on a dry run. GitLab is unchanged.
