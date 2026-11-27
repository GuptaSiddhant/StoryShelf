---
"@storyshelf/app": patch
---

Fixed: absent values, relative times and the token list read the same everywhere

An absent value is one `Absent` (a dash with a hidden "none") in cells and in `Stat` (`value={null}`), instead of a typed "—" or "–". A relative time such as "5 h ago" is now reachable by keyboard and shows its exact time on focus, an access token that was never used says "Never used", and the git token expiry on System shows a formatted date. Ratchets ban a dash literal as a value and a line break that runs a word into `<code>`, and the skill's rules say how to write absent values, dates and line breaks.
