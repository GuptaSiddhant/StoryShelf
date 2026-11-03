// Authenticating reverse proxy in front of `playwright run-server` on the browser Sprite.
//
// The Playwright server has no authentication of its own, and a Sprite's URL routes to one
// port, so this proxy is what the internet reaches: it forwards a connection to the local
// Playwright server only when the request carries the shared secret in `x-storyshelf-secret`,
// and answers everything else with 401 before the upstream sees a byte. The secret is read from
// the environment or a file, compared in constant time, and never logged.
//
//   SPRITE_BROWSER_SECRET or SPRITE_BROWSER_SECRET_FILE   the shared secret (at least 16 chars)
//   PORT (default 8080)                                    where the Sprite's URL points
//   PLAYWRIGHT_PORT (default 3000)                         the local `playwright run-server`
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";

/** The header the client sends the shared secret in. */
export const SECRET_HEADER = "x-storyshelf-secret";
/** A secret shorter than this is refused at start-up: it would not survive a guessing attack. */
export const MIN_SECRET_LENGTH = 16;

const digest = (value) => createHash("sha256").update(value).digest();

/** Whether `given` equals `secret`, without leaking where they differ or how long they are. */
export function secretMatches(secret, given) {
  if (typeof given !== "string" || given === "") {
    return false;
  }
  return timingSafeEqual(digest(secret), digest(given));
}

/**
 * The proxy as an `http.Server` (not yet listening).
 *
 * @param {{ secret: string, upstreamPort: number, upstreamHost?: string }} options
 */
export function createProxy(options) {
  const { secret, upstreamPort, upstreamHost = "127.0.0.1" } = options;
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`The browser secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  const server = createServer((request, response) => {
    if (!secretMatches(secret, request.headers[SECRET_HEADER])) {
      response.writeHead(401, { "content-type": "text/plain" }).end("unauthorized\n");
    } else if (request.url === "/healthz") {
      probe(upstreamHost, upstreamPort, (up) => {
        response
          .writeHead(up ? 200 : 503, { "content-type": "text/plain" })
          .end(up ? "ok\n" : "starting\n");
      });
    } else {
      response.writeHead(404, { "content-type": "text/plain" }).end("not found\n");
    }
  });
  server.on("upgrade", (request, socket, head) => {
    if (!secretMatches(secret, request.headers[SECRET_HEADER])) {
      refuse(socket, "401 Unauthorized");
      return;
    }
    bridge(request, head, socket, { upstreamPort, upstreamHost });
  });
  return server;
}

/**
 * Answer an upgrade with a bodiless refusal and drop the socket once it is flushed. `end()` alone
 * half-closes: a client that never sends FIN would keep the descriptor open for ever.
 */
function refuse(socket, status) {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroySoon();
}

/** Pipe an authenticated upgrade through to the Playwright server, or answer 503 while it is down. */
function bridge(request, head, socket, { upstreamPort, upstreamHost }) {
  let connected = false;
  let answered = false;
  const upstream = connect(upstreamPort, upstreamHost, () => {
    connected = true;
    upstream.write(upgradeRequest(request));
    upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  const close = () => {
    upstream.destroy();
    // A 503 being flushed ends the client socket itself; destroying it here would drop the answer.
    if (!answered) {
      socket.destroy();
    }
  };
  // The Playwright server is not up yet (the Sprite is still waking): say so, rather than hang up.
  upstream.on("error", () => {
    if (!connected && socket.writable) {
      answered = true;
      refuse(socket, "503 Service Unavailable");
    }
    close();
  });
  socket.on("error", close);
  socket.on("close", close);
  upstream.on("close", close);
}

/** The upgrade request as the upstream should see it: the client's own, minus the secret. */
function upgradeRequest(request) {
  let text = `${request.method} ${request.url} HTTP/1.1\r\n`;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index];
    if (name.toLowerCase() !== SECRET_HEADER) {
      text += `${name}: ${request.rawHeaders[index + 1]}\r\n`;
    }
  }
  return `${text}\r\n`;
}

/** Whether something accepts TCP connections at the address. */
function probe(host, port, done) {
  const socket = connect(port, host);
  socket.setTimeout(1000);
  socket.once("connect", () => {
    socket.destroy();
    done(true);
  });
  socket.once("error", () => done(false));
  socket.once("timeout", () => {
    socket.destroy();
    done(false);
  });
}

function secretFromEnvironment(env) {
  const file = env.SPRITE_BROWSER_SECRET_FILE;
  return (file ? readFileSync(file, "utf8") : (env.SPRITE_BROWSER_SECRET ?? "")).trim();
}

if (process.argv[1] === import.meta.filename) {
  const port = Number(process.env.PORT ?? 8080);
  const upstreamPort = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
  // Not 0.0.0.0-only knowledge: the Sprite's URL reaches whatever listens on `port`.
  createProxy({ secret: secretFromEnvironment(process.env), upstreamPort }).listen(port, () => {
    process.stdout.write(`browser proxy on :${port} -> playwright :${upstreamPort}\n`);
  });
}
