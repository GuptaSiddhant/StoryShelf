---
"@storyshelf/app": minor
"@storyshelf/core": minor
---

Security: rate limits key on the client behind a trusted proxy, via a new trustProxy setting (#911)

Behind a load balancer every client used to share the proxy's rate-limit buckets, so one client could use up sign-in for everyone. `ShelfConfig.trustProxy` (a hop count, a list of IPs/CIDRs, or `"fly"`) names the proxies allowed to report the client; the shipped servers read it from `TRUST_PROXY`, and the Fly server trusts `Fly-Client-IP` on Fly. A forwarded header from an untrusted peer is never read. Unset, behaviour is unchanged: set `TRUST_PROXY` (usually `1`) when you run behind a load balancer.
