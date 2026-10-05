import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpMiddleware } from "./middleware.ts";
import { installTestTelemetry, type TestTelemetry } from "./test-setup.ts";

describe("createHttpMiddleware", () => {
  let telemetry: TestTelemetry | undefined;

  afterEach(async () => {
    await telemetry?.cleanup();
    telemetry = undefined;
  });

  it("emits one server span with route-template naming and reqId", async () => {
    telemetry = installTestTelemetry();
    const app = new Hono();
    app.use("*", requestId());
    app.use("*", createHttpMiddleware({ serviceName: "test-shelf", serviceVersion: "0.0.1" }));
    app.get("/hello/:name", (c) => c.text(`hi ${c.req.param("name")}`));

    const response = await app.request("/hello/world", { method: "GET" });
    expect(response.status).toBe(200);

    const spans = telemetry.exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe("GET /hello/:name");
    expect(spans[0]?.attributes["storyshelf.req_id"]).toBeTypeOf("string");
    expect(spans[0]?.attributes["http.response.status_code"]).toBe(200);
  });

  it("continues the inbound traceparent", async () => {
    telemetry = installTestTelemetry();
    const app = new Hono();
    app.use("*", createHttpMiddleware());
    app.get("/ping", (c) => c.text("pong"));

    const response = await app.request("/ping", {
      headers: { traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" },
    });
    expect(response.status).toBe(200);

    const spans = telemetry.exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.spanContext().traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });
});
