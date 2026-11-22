---
"storyshelf": patch
---

Internal: the CLI checks its renamed-settings copy against @storyshelf/common (#1334)

The CLI keeps its own seven rows rather than depend on common (it would add `@opentelemetry/api`, about 2 MB, to a client-only install). Its drift test now reads common's table instead of core's, and the dev dependency on core is gone.

Schema: none.
