---
"@storyshelf/app": patch
"@storyshelf/core": patch
---

Fixed: accessibility and focus gaps from the UI audit (#935). A component opened by its file path no longer warns that it "moved" when the catalog stores the path with a leading `./`. Signing in now returns to the page you asked for (`return_to` is kept through the sign-in redirect). Focus lands on the page heading after a review action, comment or failed sign-in, instead of being lost. The build page has a "Skip to comparison" link; the mobile menu moves focus in, keeps the page behind it inert and gives focus back on close; the sticky review bar no longer covers focused content. The not-found page and the Storybook wrapper page have a heading and a main landmark, the profile page has one h1, and the sidebar collapse button reports `aria-expanded`.
