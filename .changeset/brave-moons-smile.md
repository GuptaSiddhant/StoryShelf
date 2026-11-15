---
"storyshelf": patch
"@storyshelf/app": patch
---

Fixed: `server init --cloud` writes only inputs the GCP and Azure modules declare (#1094)

The stub passed `domain_name` to every module, but only AWS has it. GCP now asks for `public_base_url`, and Azure asks for the required `allowed_cidr_blocks`. Shutdown now counts `graceMs` once: the wait for boot tasks gets only what the job drain left of it, so a stopping host stays inside the platform timeout (Cloud Run: 10 s).

Schema: none.
