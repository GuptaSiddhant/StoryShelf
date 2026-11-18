import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A server that answers the Postgres SSLRequest with `S`, then speaks TLS with a certificate signed
// by a throwaway CA. It proves `ssl: { ca }` verifies the chain and hostname, and that
// `sslmode=require` in the URL does not (the gap behind DATABASE_CA).
let dir = "";
let caPem = "";
let server: Server;
let port = 0;
let handshakes = 0;

function noop(): void {}

function openssl(...args: string[]): void {
  execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "shelf-tls-"));
  writeFileSync(join(dir, "san.cnf"), "subjectAltName=DNS:localhost\n");
  openssl(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
    "-subj",
    "/CN=Test CA",
  );
  openssl(
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "s.key",
    "-out",
    "s.csr",
    "-subj",
    "/CN=localhost",
  );
  openssl(
    "x509",
    "-req",
    "-in",
    "s.csr",
    "-CA",
    "ca.pem",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "s.pem",
    "-extfile",
    "san.cnf",
    "-days",
    "1",
  );
  caPem = readFileSync(join(dir, "ca.pem"), "utf8");
  const [key, cert] = [readFileSync(join(dir, "s.key")), readFileSync(join(dir, "s.pem"))];
  server = createServer((raw) => {
    raw.once("data", () => {
      raw.write("S");
      const tls = new TLSSocket(raw, { isServer: true, key, cert });
      tls.on("secure", () => {
        handshakes += 1;
        tls.destroy();
      });
      tls.on("error", () => raw.destroy());
    });
    raw.on("error", noop);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

/** `handshake` when TLS was accepted and no certificate error followed, else the driver's error code. */
async function connect(query: string, ssl?: { ca: string }): Promise<string> {
  const before = handshakes;
  const sql = postgres(`postgres://u:p@localhost:${port}/db${query}`, {
    ...(ssl === undefined ? {} : { ssl }),
    max: 1,
    connect_timeout: 3,
    fetch_types: false,
  });
  let code = "";
  sql`select 1`.then(noop, (error: { code?: string }) => {
    code = error.code ?? "error";
  });
  // TLS 1.3: the client checks the certificate after the server's handshake completes.
  await new Promise((resolve) => setTimeout(resolve, 500));
  await sql.end({ timeout: 0 });
  // The server hangs up after the handshake, which the driver reports as a closed connection.
  const hungUp = code === "" || code.startsWith("CONNECTION_");
  return hungUp && handshakes > before ? "handshake" : code;
}

describe("verifying the database certificate", () => {
  it("accepts a private CA's certificate unchecked when only sslmode=require is given", async () => {
    expect(await connect("?sslmode=require")).toBe("handshake");
  });

  it("completes the handshake when the CA is given", async () => {
    expect(await connect("?sslmode=verify-full", { ca: caPem })).toBe("handshake");
  });

  it("refuses the same server without the CA", async () => {
    expect(await connect("?sslmode=verify-full")).toMatch(/CERT|SELF_SIGNED|UNABLE_TO/u);
  });
});
