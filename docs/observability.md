# Observability (OpenTelemetry)

StoryShelf emits OpenTelemetry traces and metrics to **your own** collector,
and correlates its JSON logs with those traces. Nothing leaves your
deployment unless you configure an endpoint: without one, observability is a
zero-overhead noop and behavior is byte-identical to an uninstrumented
server. (Design rationale lives in [ADR 0022](./adr/0022-opentelemetry-observability.md).)

> Note on words: this package is named `observability`, not `telemetry`,
> deliberately. Here "telemetry" is reserved for a possible future opt-in
> feature that reports anonymous usage back to StoryShelf. The observability
> described on this page exports only to endpoints you configure.

## Quickstart

Point StoryShelf at any OTLP/HTTP collector (OTEL Collector, Tempo, Jaeger,
Honeycomb, Grafana Cloud):

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318 \
OTEL_SERVICE_NAME=storyshelf-prod \
nub run serve
```

With Docker Compose, add a collector service and the two variables to the
`storyshelf` service:

```yaml
services:
  storyshelf:
    environment:
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
      - OTEL_SERVICE_NAME=storyshelf-prod
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.122.0
    command: ["--config=/etc/otelcol/config.yaml"]
    volumes:
      - ./otelcol.yaml:/etc/otelcol/config.yaml
```

Upload a build and you will see one trace per upload: the `http.server`
request span parenting the async `capture.job` span (extract → render →
persist), with every log line carrying the same `trace_id`.

## Environment reference

| Variable | Default | Meaning |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset (disabled) | OTLP/HTTP base URL, e.g. `http://collector:4318`. Unset ⇒ noop. |
| `OTEL_SERVICE_NAME` | `storyshelf` | Resource `service.name`. |
| `OTEL_EXPORTER_OTLP_HEADERS` | unset | Extra OTLP headers, `k=v,k2=v2` (e.g. `authorization=Bearer …`). |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | SDK default (`parentbased_always_on`) | Standard sampling. Production suggestion: `traceidratio` + `0.1`. |
| `OTEL_SDK_DISABLED` | `false` | `true` forces noop even with an endpoint. |
| `STORYSHELF_OTEL_ENABLED` | auto (on iff endpoint set) | Explicit kill-switch (`false`) or force-on (`true`). |
| `STORYSHELF_OTEL_METRICS_INTERVAL_MS` | `60000` | Metric export interval. |
| `OTEL_DENO` | unset | Deno-only: `true` uses Deno's native OTEL; the Node SDK never starts under Deno. |

## Span catalog

| Span | Where | Attributes |
|---|---|---|
| `http.server` | Every request (`@hono/otel`) | `http.method/route/status`, `storyshelf.req_id`, `enduser.id` |
| `capture.job` | One per capture (server or worker) | `storyshelf.build_id`, `storyshelf.req_id`, `storyshelf.attempt_no` |
| `capture.extract` / `capture.persist-statics` / `capture.render` / `capture.persist` | Orchestrator phases | `storyshelf.render_count` (render) |
| `db.insert/get/list/…` | Instrumented database adapter | `db.table` |
| `storage.read/write/…` | Instrumented storage adapter | `storage.path` |
| `ai.summarize` | One per AI call (`@storyshelf/ai`) | `ai.task`, `ai.profile`, `ai.model` |
| `invoke_agent {model}` / `chat {model}` | The AI SDK's `@ai-sdk/otel` GenAI spans, nested under `ai.summarize` | `gen_ai.*` usage attributes (prompts, images and outputs are never recorded) |
| `http.client` | Outbound `httpJson` (git hosts, webhooks, OIDC) | `http.request.method`, `url.full` (query redacted), `http.retry.count` |

Span names never contain IDs, paths, or branch names. Remote workers
continue the enqueueing request's trace via the `traceparent` job field, so
an upload's trace spans the HTTP request **and** the worker process.

## Metric catalog

| Instrument | Type | Attributes |
|---|---|---|
| `http.server.request.duration` | histogram | `method`, `route`, `status` (via `@hono/otel`) |
| `capture.job.duration` | histogram (ms) | — |
| `capture.jobs.completed` / `capture.jobs.failed` | counters | — |
| `db.operation.duration` | histogram (ms) | `db.operation`, `db.table` |
| `storage.operation.duration` | histogram (ms) | `storage.operation` (paths excluded: cardinality) |
| `ai.summarize.duration` / `ai.summarize.tokens` | histograms | `ai.task`, `outcome` (model and profile stay on spans) |
| `ai.insights.completed` / `ai.insights.failed` | counters | `ai.task` |

No per-story or per-build instruments — labels stay low-cardinality by rule.

## Log correlation

Every log line carries `trace_id`/`span_id` whenever a span is active
(`otelLogMixin`, wired as the pino `mixin` in all server scaffolds), so
`LOG_LEVEL=debug` output joins directly with traces in your backend. Logs
stay on stdout as JSON — there is intentionally no OTLP log exporter (see
ADR 0022 §6); your collector/agent forwards stdout as usual.

## Sampling guidance

- Development: default (sample everything).
- Production: `OTEL_TRACES_SAMPLER=traceidratio`,
  `OTEL_TRACES_SAMPLER_ARG=0.1`, plus tail-based sampling in the collector
  (keep errors + slow captures) for the best cost/fidelity tradeoff.
- Captures are long (minutes); ensure your backend's trace timeout exceeds
  your longest capture.

## Deno

The instrumentation code uses `@opentelemetry/api` only, which Deno bridges
natively: run with `OTEL_DENO=true` plus your endpoint and spans/metrics
light up with no SDK setup. The Node SDK (`@storyshelf/observability/node`)
refuses to start under Deno by design.

## Troubleshooting

| Symptom | Check |
|---|---|
| No spans arrive | `OTEL_EXPORTER_OTLP_ENDPOINT` reachable from the server? `OTEL_SDK_DISABLED` unset? `STORYSHELF_OTEL_ENABLED` not `false`? |
| Spans arrive but capture is detached | Queue payload dropping `traceparent` (third-party queue?) — in-process and bundled queues propagate automatically. |
| Missing `trace_id` in logs | Server started from a scaffold that passes `mixin: otelLogMixin` to `createShelfLogger`? |
| High metric cardinality | Custom dashboards grouping by `db.table` with unbounded table growth — aggregate by `db.operation` instead. |
| SDK startup errors | Collector TLS/host mismatch; SDK logs to stderr and the server keeps serving (telemetry never blocks requests). |
