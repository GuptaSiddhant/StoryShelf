---
"@storyshelf/app": patch
---

Fixed: Storybook resolver links and alias hosts keep the query, so a shared deep link opens its story

`/projects/:slug/storybook?path=…`, label links (`/projects/:slug/storybook/:key/:value?…`) and the
`<slug>.<baseDomain>` alias host used to drop the query on their redirect, so a deep link opened the
build's first story instead. The query now passes through every hop, in every hosting mode; in
`subdomain` mode it reaches the build's content host. Adds tests for legacy links under subdomain
hosting (#360) and documents what each old link becomes, private-link behaviour and rollback.
