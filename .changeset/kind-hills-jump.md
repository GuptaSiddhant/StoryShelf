---
"@storyshelf/app": minor
"@storyshelf/core": minor
---

Changed: project Settings is one page with grouped tabs, plus Insights (#807)

General, Capture & tests, Review & notifications, Access and Insights replace the eleven separate settings pages and their second sidebar; the tab is in the URL (`/settings/<tab>`), so links and Back work. Insights holds the operator numbers that sat on the Builds page (average inherited share, the AI health digest) with capture timings, accessibility totals and the Jobs list, so the Builds page starts with its filters and table. The old settings, labels-settings and jobs URLs redirect to their tab. Diff thresholds now save on their own form.
