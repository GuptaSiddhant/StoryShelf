---
"@storyshelf/affected": patch
"storyshelf": patch
"@storyshelf/app": patch
---

Fixed: no git errors outside a checkout; home page leads with Create project

`storyshelf upload` in a directory without git no longer prints `fatal: not a git repository`. With sign-in on and no admin token, the home and empty projects pages lead with "Create project" and mention `storyshelf create` only when it can work. The home page no longer says where overlay images are stored.

Schema: none
