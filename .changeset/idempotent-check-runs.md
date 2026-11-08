---
"@storyshelf/notify-git": patch
---

Fixed: GitHub check runs are idempotent and follow changed findings. A check run is found among all runs of the commit with its id, and when two deliveries race to create it the runs are listed again and every run with the id is brought to the same state. Annotations are compared finding by finding (and by the hash of the set in the run's summary) instead of by count, so a changed finding is posted even when the count is unchanged and a repeat adds nothing. The summary lists the current findings first and says how many earlier annotations on the run are history.
