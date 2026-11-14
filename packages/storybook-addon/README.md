# @storyshelf/storybook-addon

A read-only Storybook addon that puts StoryShelf's review state beside each story in the sidebar:
**Unchanged**, **Changed**, **New**, **Pending review**, **Approved**, **Rejected**, and **Design
stale** or **Design deleted** when a linked design has drifted. A badge links to the build's review.

It reads only. It never posts a verdict, a comment or anything else (ADR 0042).

## Where it works

The addon runs only in a Storybook that StoryShelf publishes, opened at its canonical path on the
app origin: `/projects/<slug>/storybook/build/<build-id>/`. It reads the project and build from
`location.pathname`, so nothing is injected into the uploaded files.

Everywhere else it does nothing and makes no request:

- a local `storybook dev`, or a Storybook hosted elsewhere;
- a project subdomain (`publishedBaseDomain`);
- a sandboxed page (opaque origin).

Badges also need the instance to have `testing` on, and a signed-in viewer of the project (or an
instance without sign-in). Anonymous viewers of a public build get the Storybook, not the badges.

## Install

```sh
nub add -D @storyshelf/storybook-addon
```

```ts
// .storybook/main.ts
export default {
  addons: ["@storyshelf/storybook-addon"],
};
```

Storybook 8.6, 9 and 10 are supported. The addon sets `sidebar.renderLabel`, so another addon or your
own `renderLabel` in `.storybook/manager.ts` replaces or is replaced by it, whichever loads last.
Adding it changes nothing for a Storybook you upload elsewhere: the addon switches itself off.

## How it talks to StoryShelf

Two same-origin `GET`s with `credentials: "same-origin"`: `/api/v1/health` (the addon stays off unless
`testing` is `true`), then `/api/v1/projects/<slug>/builds/<build-id>/story-status`. The browser sends
the viewer's session cookie; the addon never reads, stores or accepts a token, and needs no CORS. The
answer holds a status per story and the build's relative `reviewPath`, never images, comments or
reviewer identities. A story with no snapshot gets no badge.

## Public surface

The package exports its response types (`StoryStatusBody`, `StoryStatusEntry`) and the Storybook
preset (`@storyshelf/storybook-addon/preset`). The manager entry is internal. It does not import
`@storyshelf/core` or `@storyshelf/app`; `src/types.ts` is a small copy of the response, checked by a
test against the app's OpenAPI document.

## Development

```sh
nub run test               # hermetic unit tests
nub run build              # dist/ (and dist/legacy/ for Storybook 8.6)
# Load the built addon in each fixture's Storybook (8.6, 9, 10) in a real browser:
(cd ../../fixtures/storybook-8 && pnpm install)   # likewise storybook-9, storybook-10
nub run test:integration
```

Storybook 8.6 exposes the manager API as `@storybook/manager-api`; 9 and later as
`storybook/manager-api`. Only `src/manager-api.ts` names it. The build writes a second copy of the
manager code to `dist/legacy/` with the 8.6 name, and the preset picks one by the Storybook version it
finds.
