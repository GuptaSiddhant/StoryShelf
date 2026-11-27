---
"@storyshelf/app": patch
---

Fixed: an avatar with no name is hidden from assistive tech; moving a disabled git channel says the link will post

An `Avatar` with an empty name no longer renders `role="img"` with an empty label (axe `role-img-alt`); it is decoration (`aria-hidden`) because every caller prints the name beside it. The move dialog for a disabled System → Git channel now says that the repository link posts statuses for the project once it is moved.
