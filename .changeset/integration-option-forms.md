---
"@storyshelf/core": minor
"@storyshelf/app": minor
---

Added: integration options take an array, a function of the built-ins, or `false` (ADR 0049).

ADR 0049, decision 3. Each integration group now accepts an array (exactly these, as before), a
function `(builtIn) => list` that adds a custom provider, replaces a built-in of the same kind or
filters some out, or `false` for none. `resolveShelfOptions` resolves them once at startup against
the built-in list in `@storyshelf/core/integrations` (empty for now; the move tasks fill it). A
provider that breaks its adapter contract, or a provider kind that repeats within a group, throws at
startup, naming the kind. `notifications.email` is resolved and checked but not yet used by the app.
App internals take the new `ResolvedShelfOptions` type; `createShelfApp` still takes `ShelfOptions`.
