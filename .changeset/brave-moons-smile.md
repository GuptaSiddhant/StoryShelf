---
"storyshelf": patch
---

Fixed: `server init --cloud` writes only inputs the GCP and Azure modules declare (#1094)

The stub passed `domain_name` to every module, but only AWS has it. GCP now asks for `public_base_url`, and Azure asks for the required `allowed_cidr_blocks`. The published image also reads `SHUTDOWN_GRACE_SECONDS` for its SIGTERM drain.

Schema: none.
