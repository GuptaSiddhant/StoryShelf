---
"@storyshelf/app": minor
"@storyshelf/core": minor
---

Added: report an unreachable capture target in health, on System and as one alert

A launch or connect failure marks the capture target unreachable (time and a fixed reason class, never an endpoint, header or lease) until it next renders. `POST /api/v1/health` adds `targets` for site admins, System → Capture browsers shows since when with a link to the remote-browsers guide, and admin channels get one `sys:target-unreachable` and one `sys:target-recovered` alert, never one per failed build. The open `GET` health answer is unchanged.

Schema: none.
