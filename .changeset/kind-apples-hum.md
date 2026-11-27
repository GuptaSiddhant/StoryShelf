---
"@storyshelf/app": patch
---

Fixed: members show their names, a non-admin's empty page says to ask an admin, and 403 has a page

The members table in Settings, Access shows each member's display name and email, not their user id; a member whose account is gone reads "Unknown user". A signed-in non-admin with no project sees "You have not been added to a project yet. Ask an admin." and none of the admin's setup steps. A 403 renders the app's own page in the shell, the way the not-found page does, for browser page requests; API answers and form posts keep their plain answer.
