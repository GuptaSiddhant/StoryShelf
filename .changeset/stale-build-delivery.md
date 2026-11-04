---
"@storyshelf/notify-git": patch
---

Fixed: in GitHub `checks` mode, a late delivery for an older build no longer overwrites the check run of a newer build of the same commit. The run's link names its build; build ids sort by time, so when a run of the commit already links to a newer build the older delivery writes nothing. A link whose build cannot be read is updated as before.
