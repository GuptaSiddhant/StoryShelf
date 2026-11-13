---
"@storyshelf/app": patch
---

Changed: approve, reject and comment on the review page swap in place, with no page load (#937).

From the review page, an HTMX approve or reject (single snapshot or a whole story/mode) now answers
with the next open snapshot as HTML to swap into the stage, the header and the snapshot list out of
band and `HX-Push-Url` for the new `?snapshot=`, so scroll stays put and focus moves to the new
snapshot's heading. Deciding the last open snapshot shows the build's "Review complete" state. A
plain or API request still gets JSON, and a changed baseline still redirects to the diff page.
Posting a snapshot comment swaps only its comment card, with the box emptied and focused. The
snapshot approve and reject operations document the `text/html` answer in the OpenAPI document.
