---
title: Test app pages
description: Render real app routes as Storybook stories against mocked data (MSW), so StoryShelf captures, diffs and reviews whole pages with no product change.
---

If your design system is in Storybook but your app is not, you can still put the app's pages under visual review. Write **page stories**: stories that render a real route or screen of the app, with its providers and a router, against mocked network responses. To StoryShelf they are ordinary stories, so upload, capture, per-branch baselines, review and the pull-request status all work on them. StoryShelf tests its own UI this way.

## When to use it

Page stories cover the layout of a page, each of its states, and the real components on real routes. They do not cover a real backend, sign-in flows or journeys across several pages; see [Limits](#limits). Use them when you want a visual check of what a user sees on each page, not an end-to-end test.

## Set up MSW

[Mock Service Worker](https://mswjs.io/) answers the page's `fetch` calls from handlers you write per story, so no server runs. The versions below are the ones this guide was tested with (Storybook 9, React, Vite):

```sh
npm i -D msw@2.15.0 msw-storybook-addon@3.0.3 mockdate@3.0.5
npx msw init public/
```

`msw init` writes `public/mockServiceWorker.js`. Put that folder in `staticDirs` so the **uploaded static build** serves the worker, not only the dev server:

```ts
// .storybook/main.ts
import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
  staticDirs: ["../public"],
};
export default config;
```

Start the worker with a loader, and make a request with no handler an error:

```tsx
// .storybook/preview.tsx
import type { Preview } from "@storybook/react-vite";
import { setupWorker } from "msw/browser";
import { mswLoader } from "msw-storybook-addon/csf3";

const preview: Preview = {
  loaders: [
    mswLoader(async () => {
      const worker = setupWorker();
      await worker.start({ onUnhandledRequest: "error", quiet: true });
      return worker;
    }),
  ],
};
export default preview;
```

Each story then lists its own handlers in `parameters.msw.handlers`:

```tsx
import { http, HttpResponse } from "msw";

export const Full: Story = {
  parameters: {
    msw: { handlers: [http.get("/api/orders", () => HttpResponse.json(orders))] },
  },
};
```

With `onUnhandledRequest: "error"` an unmatched request is logged by MSW and fails in the page, which then shows its error state. The story still renders, so the stray request appears as a changed screenshot, not as a failed build. Keep the handlers in the story, next to the state they produce.

## Render a route

Wrap the page in what it needs at runtime: the app's providers, a router fixed at one path, and a session with a fake signed-in user. A decorator on the page's stories does this once. With React Router:

```tsx
// src/OrdersPage.stories.tsx
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter, Route, Routes } from "react-router";
import { OrdersPage } from "./OrdersPage";
import { SessionProvider } from "./session";
import { admin } from "./orders.fixtures";

const meta = {
  title: "Pages/Orders/List",
  component: OrdersPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story, { parameters }) => (
      <SessionProvider user={parameters["user"] ?? admin}>
        <MemoryRouter initialEntries={["/orders"]}>
          <Routes>
            <Route path="/orders" element={<Story />} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    ),
  ],
} satisfies Meta<typeof OrdersPage>;
export default meta;
type Story = StoryObj<typeof meta>;
```

`layout: "fullscreen"` removes Storybook's padding so the screenshot is the page. A story that needs another user sets `parameters.user`.

Other frameworks follow the same idea. In Next.js, set the route with the `nextjs.navigation` parameters (`pathname`, `query`) instead of a router component. In Vue, create the router with `createMemoryHistory()` and register it with Storybook's `setup` hook. Use the app's client-side rendering in every case.

## Make captures repeatable

Capture itself is handled for you: the runner waits for Storybook to report the story rendered, lets fonts load, and disables CSS animations (see [Interaction testing](/guides/interaction-testing/#when-the-screenshot-is-taken) and [Capture & viewports](/concepts/capture/)). A page story still has to take everything the runner cannot control out of the page:

- **A frozen clock.** Anything that prints "today", "3 minutes ago" or a countdown changes between runs. Freeze `Date` for every story in `preview`, or inject the app's own clock:

  ```tsx
  // .storybook/preview.tsx
  import MockDate from "mockdate";

  const preview: Preview = {
    beforeEach: () => {
      MockDate.set("2026-01-15T12:00:00.000Z");
      return () => MockDate.reset();
    },
  };
  ```

- **Seeded fixtures with fixed ids.** Write the fixtures by hand, or generate them with a fixed seed, and give every record a literal id and timestamp. Never use `Math.random()`, `crypto.randomUUID()` or `new Date()` to build data.
- **No animation.** The screenshot disables CSS animations and transitions. Animations driven by JavaScript (a chart that draws itself, a carousel on a timer) need a switch in the app, or a `parameters.storyshelf.delay` once they settle.
- **Stable fonts.** Ship the fonts in the build (self-hosted files, not a font service that is fetched at render time), and do not depend on the system fonts of the machine. The capture [fingerprint](/concepts/capture/) includes the installed fonts, so a different host looks like an environment change.
- **No network outside MSW.** Keep `onUnhandledRequest: "error"`, and mock images and other assets the page loads from another origin, or serve them from `staticDirs`.

A story whose render still differs each time is flagged by StoryShelf; see [Unstable renders](/guides/review/#unstable-renders).

## One story per state

Give a page one story for each state a user can reach, and name them `Pages/<Area>/<Page>` so they group in the catalog:

```text
Pages/Orders/List → Loading, Empty, Full, ServerError, PermissionDenied
```

For a loading state, make the handler wait forever (`await delay("infinite")` from `msw`), so the screenshot shows the spinner and not a race. For an error, return a status; for permission-denied, change the user and leave the handler alone. Each story is then its own snapshot with its own baseline, and a change to one state shows up on that story alone.

## Limits

- **No real backend.** Every request is mocked, so a page story proves how the page looks for a given response, not that the API returns it.
- **No server rendering.** Stories render in the browser. A page that only works through server-side data loading needs its client-side path.
- **No journeys.** One story is one page at one path. Sign-in, checkout and other flows across pages are not covered, and `play` functions (see [Interaction testing](/guides/interaction-testing/)) reach only within a page.
- **Canvas and WebGL charts** draw with their own randomness and timing. Give them a fixed seed and data, or capture the page without them.

## Try it

Build and upload as for any Storybook ([Getting started](/guides/getting-started/), [CI setup](/guides/ci/)); nothing in the project settings changes. Open the first build, approve it as the baseline, and upload again: an unchanged page reports no changes.
