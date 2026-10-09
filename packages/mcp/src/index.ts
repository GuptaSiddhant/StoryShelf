import { parseArgs } from "node:util";
import { resolveConfig, type McpConfig } from "./config.ts";

const HELP = `storyshelf-mcp: StoryShelf MCP server

Usage: storyshelf-mcp [--http] [--port 3333] [--host 127.0.0.1] [--url URL] [--slug SLUG] [--token TOKEN] [--origin ORIGIN]

Env: STORYSHELF_URL, STORYSHELF_TOKEN (or SHELF_TOKEN), STORYSHELF_SLUG
Default transport is stdio. With --http, a Streamable HTTP endpoint is served at /mcp
and each client sends its own "Authorization: Bearer <token>".`;

interface CliValues {
  http?: boolean;
  port?: string;
  host?: string;
  url?: string;
  slug?: string;
  token?: string;
  origin?: string[];
  help?: boolean;
}

function parseCli(): CliValues {
  return parseArgs({
    options: {
      http: { type: "boolean" },
      port: { type: "string" },
      host: { type: "string" },
      url: { type: "string" },
      slug: { type: "string" },
      token: { type: "string" },
      origin: { type: "string", multiple: true },
      help: { type: "boolean", short: "h" },
    },
  }).values;
}

function configFrom(values: CliValues): McpConfig {
  return resolveConfig(process.env, {
    ...(values.url ? { url: values.url } : {}),
    ...(values.slug ? { slug: values.slug } : {}),
    ...(values.token ? { token: values.token } : {}),
  });
}

async function runHttp(values: CliValues, config: McpConfig): Promise<void> {
  const { serveHttp } = await import("./http.ts");
  const port = Number(values.port ?? process.env["PORT"] ?? 3333);
  const host = values.host ?? "127.0.0.1";
  await serveHttp({
    url: config.url,
    ...(config.slug ? { slug: config.slug } : {}),
    ...(values.origin ? { allowedOrigins: values.origin } : {}),
    port,
    host,
  });
  process.stderr.write(`storyshelf-mcp listening on http://${host}:${port}/mcp\n`);
}

async function main(): Promise<void> {
  const values = parseCli();
  if (values.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const config = configFrom(values);
  if (values.http) {
    await runHttp(values, config);
    return;
  }
  const { runStdio } = await import("./stdio.ts");
  await runStdio(config);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
