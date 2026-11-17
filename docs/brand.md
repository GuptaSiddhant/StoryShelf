# Brand and voice

How StoryShelf looks and sounds. Issue #1092 set the mark; #946 set the violet accent.

## The mark

An S-shaped shelf whose top and bottom boards run to the edge of the tile, holding four stories:
three outlined (unchanged) and one solid, top right (the changed one). So the mark says "diff", not
only "library". It is original: no borrowed letterform or container. Issue #1092 replaced the
earlier three-books mark.

- **Two colours only.** A base and a foreground, no accent, in the app too. The default is
  `purple-white`: base `#5b3fd6`, foreground `#ffffff`. The violet matches the app's `accent`
  token (`packages/core/src/brand-packs.ts`), which still colours the interface; the mark itself
  never takes a third colour.
- **Pairs.** `purple-white`, `black-white`, `white-black` and `white-purple` (base, then
  foreground), each in `rounded` (radius 14 on the 64 grid) and `square` corners: eight files.
- **White-base pairs** (`white-black`, `white-purple`) have no visible edge on a white page, so
  use them on dark or coloured surfaces only (the website header in dark mode, the social card).
  Light surfaces use `purple-white` or `black-white`.
- **16 px.** The four stories blur, so a small drawing replaces the mark: the S with heavier
  boards and one enlarged solid story (`storyshelf-logo-purple-white-small.svg`). It is used at
  16 px and at 32 px (the outlined stories still blur there), and for `favicon.svg`, so every
  favicon, `favicon.ico` included, is the small drawing. Icons from 180 px up use the full mark.
- **Maskable.** `storyshelf-logo-purple-white-maskable.svg` scales the mark to 80 % on a
  full-bleed square tile, and draws the boards past the tile so they still reach the edge under
  any mask. `nub scripts/brand-icons.mjs` checks that all but the boards sits inside the 40 %
  safe circle; it was also checked by eye against circle and squircle masks.
- **Wordmark.** "StoryShelf" in the UI sans (`ui-sans-serif, system-ui, …`) at weight 600, in the
  neutral text colour (`#09090b` light, `#fafafa` dark), after the tile. Never in the accent,
  never with a gradient.
- **Format.** Hand-written SVG: no embedded fonts, no raster, no editor metadata.

### Files

The sources live in `apps/website/src/assets/brand/`:

| File                                                 | Use                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `storyshelf-logo-<pair>-<corner>.svg` (8)            | The mark; `purple-white-rounded` is the default (README, app) |
| `storyshelf-logo-purple-white-small.svg`             | 16 and 32 px favicons                                        |
| `storyshelf-logo-purple-white-maskable.svg`          | Maskable icon                                                |
| `wordmark-light.svg`, `wordmark-dark.svg`            | Tile plus wordmark per theme                                 |

The website header uses `purple-white-rounded` in light mode and `white-purple-rounded` in dark
mode. `apps/website/public/favicon.svg` is a copy of the small drawing. `nub
scripts/brand-icons.mjs` renders the PNGs and `favicon.ico` from these files and checks the maskable
safe zone (`--check` only checks). `nub scripts/screenshots.mjs og` renders `og-image.png` from the
`white-purple-rounded` tile, the wordmark text and the tagline. The app embeds the default mark and
the small drawing in `packages/app/src/assets/mark.ts`; keep them in step with the sources.

Operators still override the name and logo (`ui.name`, `ui.logo`, `SHELF_BRAND_NAME`,
`SHELF_LOGO_URL`) and the colours (brand packs). The favicon is not brandable, so a StoryShelf tab
stays recognisable. Machine names stay lowercase: the git status and check-run names are
`storyshelf/testing`, `storyshelf/review` and `storyshelf/storybook`, because branch protection
matches required checks by exact name.

## Voice

StoryShelf talks like a careful colleague: short, specific, calm.

- **Sentence case** everywhere: headings, buttons, menu items, check titles ("Review open", not
  "Review Open").
- **Plain words.** Say what happened and what to do next: "Capture failed: the Storybook did not
  load", not "An unexpected error occurred". Prefer "approve" to "accept", "build" to "run".
- **Status words match the app**: "Needs review", "Approved", "Rejected", "Failed", "Cancelled",
  "Capturing". Use the same word in the UI, the CLI, git statuses, chat and email.
- **No exclamation marks** in the CLI, and rarely anywhere else. Success is quiet: "Uploaded 42
  stories".
- **The name.** Always "StoryShelf", one word, capital S twice. Never abbreviate it to "SS". The
  short form is "Shelf" (`SHELF_*` variables, "[Shelf]" email subjects, diagrams).
- **Competitors.** Name Chromatic only on the comparison page.
