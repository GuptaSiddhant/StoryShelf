---
"@storyshelf/app": minor
---

Added: an offline home page and per-device offline settings (ADR 0048)

The offline home page is styled and shows an empty and an expired state. A new "This device" page under the profile (`/profile/offline`) keeps default-branch Storybooks per project or for all projects, shows storage use against the cap, changes the cap and syncs on demand. Outside `trusted` hosting mode it says offline Storybooks are unavailable and offers nothing to keep. The Library gains a "Keep offline" button next to "View Storybook".

Schema: none.
