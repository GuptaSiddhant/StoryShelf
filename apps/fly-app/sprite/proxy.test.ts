import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ES module run by the Sprite itself, with no type declarations
import { createProxy, MIN_SECRET_LENGTH, secretMatches } from "./proxy.mjs";

const SECRET = "correct-horse-battery-staple";
const open: { close(): unknown }[] = [];

afterEach(() => {
  for (const item of open.splice(0)) {
    item.close();
  }
});

/** An upstream that answers every upgrade with 101 and then echoes bytes, counting connections. */
async function echoUpstream(): Promise<{
  port: number;
  connections: () => number;
  open: () => number;
}> {
  let connections = 0;
  let live = 0;
  const server = createServer();
  server.on("upgrade", (_request, socket) => {
    connections += 1;
    live += 1;
    socket.on("close", () => {
      live -= 1;
    });
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
    socket.on("data", (chunk) => socket.write(chunk));
    // An http server socket keeps its half open after the peer hangs up; close it as a real server does.
    socket.on("end", () => socket.end());
    socket.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  open.push({ close: () => server.close() });
  return {
    port: (server.address() as AddressInfo).port,
    connections: () => connections,
    open: () => live,
  };
}

/** A port nothing listens on: one a server just released, so the connection is refused. */
async function closedPort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, "close");
  return port;
}

async function proxyTo(upstreamPort: number): Promise<number> {
  const server: Server = createProxy({ secret: SECRET, upstreamPort });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  open.push({ close: () => server.close() });
  return (server.address() as AddressInfo).port;
}

/** Send a raw upgrade request and collect what comes back. */
async function upgrade(port: number, headers: Record<string, string>): Promise<string> {
  const socket: Socket = connect(port, "127.0.0.1");
  open.push({ close: () => socket.destroy() });
  const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`);
  socket.write(
    `GET /pw HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n${lines.join("")}\r\n`,
  );
  const [chunk] = (await once(socket, "data")) as [Buffer];
  return chunk.toString();
}

/** Send an upgrade, keep the client half open after the answer, and expect the server to let go. */
async function expectSocketDropped(
  headers: Record<string, string>,
  upstreamPort: number,
  status: string,
): Promise<void> {
  const server: Server = createProxy({ secret: SECRET, upstreamPort });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  open.push({ close: () => server.close() });
  const socket: Socket = connect({
    port: (server.address() as AddressInfo).port,
    host: "127.0.0.1",
    allowHalfOpen: true,
  });
  open.push({ close: () => socket.destroy() });
  const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`);
  socket.write(
    `GET /pw HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n${lines.join("")}\r\n`,
  );
  const [chunk] = (await once(socket, "data")) as [Buffer];
  expect(chunk.toString()).toContain(status);
  const count = async () =>
    await new Promise<number>((resolve) => {
      server.getConnections((_error, n) => resolve(n));
    });
  await expect.poll(count).toBe(0);
}

async function get(port: number, path: string, headers: Record<string, string> = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  return { status: response.status, text: await response.text() };
}

describe("the browser proxy", () => {
  it("refuses an upgrade without the secret, or with a wrong one, before the upstream sees it", async () => {
    const upstream = await echoUpstream();
    const port = await proxyTo(upstream.port);
    expect(await upgrade(port, {})).toContain("401 Unauthorized");
    expect(await upgrade(port, { "x-storyshelf-secret": "wrong" })).toContain("401 Unauthorized");
    expect(await upgrade(port, { "x-storyshelf-secret": `${SECRET}x` })).toContain(
      "401 Unauthorized",
    );
    expect(upstream.connections()).toBe(0);
  });

  it("forwards an authenticated upgrade, and the bytes that follow, to the upstream", async () => {
    const upstream = await echoUpstream();
    const port = await proxyTo(upstream.port);
    const socket = connect(port, "127.0.0.1");
    open.push({ close: () => socket.destroy() });
    socket.write(
      `GET /pw HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nx-storyshelf-secret: ${SECRET}\r\n\r\n`,
    );
    const [first] = (await once(socket, "data")) as [Buffer];
    expect(first.toString()).toContain("101 Switching Protocols");
    socket.write("ping");
    const [echoed] = (await once(socket, "data")) as [Buffer];
    expect(echoed.toString()).toBe("ping");
    expect(upstream.connections()).toBe(1);
  });

  it("does not pass the secret on to the upstream", async () => {
    let seen = "";
    const server = createServer();
    server.on("upgrade", (request, socket) => {
      seen = request.rawHeaders.join("|").toLowerCase();
      socket.end(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    open.push({ close: () => server.close() });
    const port = await proxyTo((server.address() as AddressInfo).port);
    await upgrade(port, { "x-storyshelf-secret": SECRET });
    expect(seen).toContain("upgrade");
    expect(seen).not.toContain("x-storyshelf-secret");
    expect(seen).not.toContain(SECRET);
  });

  it("answers plain requests: 401 without the secret, /healthz with it, 404 elsewhere", async () => {
    const upstream = await echoUpstream();
    const port = await proxyTo(upstream.port);
    expect((await get(port, "/healthz")).status).toBe(401);
    expect((await get(port, "/anything")).status).toBe(401);
    expect(await get(port, "/healthz", { "x-storyshelf-secret": SECRET })).toEqual({
      status: 200,
      text: "ok\n",
    });
    expect((await get(port, "/other", { "x-storyshelf-secret": SECRET })).status).toBe(404);
  });

  it("answers an authenticated upgrade with 503 while the Playwright server is not up yet", async () => {
    const port = await proxyTo(await closedPort());
    expect(await upgrade(port, { "x-storyshelf-secret": SECRET })).toMatch(/^HTTP\/1\.1 503 /u);
  });

  it("closes the upstream when the client disconnects after the handshake", async () => {
    const upstream = await echoUpstream();
    const port = await proxyTo(upstream.port);
    const socket: Socket = connect(port, "127.0.0.1");
    socket.write(
      `GET /pw HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nx-storyshelf-secret: ${SECRET}\r\n\r\n`,
    );
    await once(socket, "data");
    expect(upstream.connections()).toBe(1);
    expect(upstream.open()).toBe(1);
    socket.destroy();
    await expect.poll(() => upstream.open()).toBe(0);
  });

  it("drops a 401'd upgrade's socket even when the client never hangs up", async () => {
    await expectSocketDropped({}, 1, "401");
  });

  it("drops a 503'd upgrade's socket even when the client never hangs up", async () => {
    await expectSocketDropped({ "x-storyshelf-secret": SECRET }, await closedPort(), "503");
  });

  it("reports 503 while the Playwright server is not up yet", async () => {
    const port = await proxyTo(await closedPort());
    expect(await get(port, "/healthz", { "x-storyshelf-secret": SECRET })).toEqual({
      status: 503,
      text: "starting\n",
    });
  });

  it("refuses to start with a short or missing secret", () => {
    expect(() => createProxy({ secret: "", upstreamPort: 1 })).toThrow(/at least/u);
    expect(() =>
      createProxy({ secret: "a".repeat(MIN_SECRET_LENGTH - 1), upstreamPort: 1 }),
    ).toThrow(/at least/u);
    expect(() =>
      createProxy({ secret: "a".repeat(MIN_SECRET_LENGTH), upstreamPort: 1 }),
    ).not.toThrow();
  });
});

describe("secretMatches", () => {
  it.each([
    [SECRET, true],
    ["", false],
    [undefined, false],
    [`${SECRET} `, false],
    [SECRET.toUpperCase(), false],
  ])("%j -> %s", (given, expected) => {
    expect(secretMatches(SECRET, given)).toBe(expected);
  });
});
