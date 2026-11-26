---
"@storyshelf/app": minor
---

Added: the image reads one remote browser from `SHELF_REMOTE_BROWSER_*`, and the AWS and GCP modules take it as secret references

The product image builds `chromium@remote` (the name is `SHELF_REMOTE_BROWSER_NAME`) from `SHELF_REMOTE_BROWSER_ENDPOINT`, `_PROTOCOL` (`playwright` or `cdp`) and `_REACH` (`loopback` or `url`), with an optional `_TOKEN` (a Bearer header), `_ENGINES`, `_SESSIONS` and `_MAX_CONNECTIONS` (the per-process connection limiter). `protocol` and `reach` are declared, never inferred, and `reach=url` needs `SHELF_SECRET` and `SHELF_PUBLIC_BASE_URL`. A half-set, unknown or malformed configuration stops boot with a message naming the variable and never its value; the endpoint and token are never logged. `PLAYWRIGHT_SERVICE_*` still adds `chromium@azure`. The AWS and GCP Terraform modules get back `remote_browser_endpoint_secret_*` and `remote_browser_token_secret_*` (secret references, never plain values in state) plus `remote_browser_protocol`, `_reach`, `_engines`, `_sessions` and `_max_connections`.

Schema: none
