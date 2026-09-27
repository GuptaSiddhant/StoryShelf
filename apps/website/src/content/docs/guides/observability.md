---
title: Observability
description: Trace captures and monitor StoryShelf with OpenTelemetry.
---

StoryShelf exports OpenTelemetry traces and metrics to **your own**
collector, and correlates its JSON logs with those traces. Nothing leaves
your deployment unless you configure an endpoint — without one,
observability is a zero-overhead noop.

> The word "telemetry" is deliberately reserved for a possible future opt-in
> feature reporting anonymous usage back to StoryShelf. Everything on this
> page exports only to endpoints you configure.

## Quickstart

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318 \
OTEL_SERVICE_NAME=storyshelf-prod \
nub run serve
```

Upload a build and you will see one trace per upload: the HTTP request span
parenting the async `capture.job` span (`extract → render → persist`), with
every log line carrying the same `trace_id`. Remote workers continue the
same trace via the queue payload.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset (disabled) | OTLP/HTTP base URL, e.g. `http://collector:4318`. |
| `OTEL_SERVICE_NAME` | `storyshelf` | Service name in spans and metrics. |
| `OTEL_EXPORTER_OTLP_HEADERS` | unset | Extra OTLP headers, `k=v,k2=v2` (collector auth). |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | always-on | Production suggestion: `traceidratio` + `0.1`. |
| `STORYSHELF_OTEL_ENABLED` | auto | Explicit `false` kill-switch. |
| `STORYSHELF_OTEL_METRICS_INTERVAL_MS` | `60000` | Metric export interval. |

Scaffolded servers (`storyshelf server init`) already include the
initialization preamble and log correlation — you only add the endpoint.

## What is exported

**Spans:** `http.server` per request, `capture.job` per capture with
`extract` / `persist-statics` / `render` / `persist` phases, `db.*` and
`storage.*` per adapter operation, `http.client` for outbound calls (git
hosts, webhooks, OIDC). Span names never contain IDs or paths.

**Metrics:** `capture.job.duration`, `capture.jobs.completed/failed`,
`db.operation.duration`, `storage.operation.duration`,
`http.server.request.duration` — all low-cardinality by rule.

**Logs:** stdout JSON unchanged, plus `trace_id`/`span_id` on every line
inside a span, so logs join with traces in your backend.

For the full reference (span/metric catalogs, sampling, Deno, troubleshooting),
see `docs/observability.md` in the repository and
[ADR 0022](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0022-opentelemetry-observability.md).
