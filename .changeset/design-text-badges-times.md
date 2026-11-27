---
"@storyshelf/app": patch
---

Fixed: badges use sentence case, an absent time is a dash, dates are written out, tabs are named

Capture targets show "Ready", "Default", "Unreachable" and "Unavailable", the project card shows "Health: Watch · 78", comment anchors read "Build" and "Story …", and the AI panels say "Generating…". An invalid time renders the absent dash instead of "unknown", a relative time older than a week reads "Nov 15, 2026" instead of an ISO date, System → Git writes the token expiry as a date, and the Insights jobs table shows relative times with the exact time on hover. The tab title of project settings is the tab's name (General, Access, …). Schema: none
