declare const __PKG_VERSION__: string | undefined;

/** Entry file of a scaffolded MCP project. */
export const MCP_ENTRY = "src/index.ts";

/** How the scaffolded MCP server is reached by agents. */
export type McpTransport = "stdio" | "http";

export interface McpScaffoldAnswers {
  name: string;
  dir: string;
  transport: McpTransport;
  url: string;
  slug: string;
  docker: boolean;
}

/** `src/index.ts`: stdio runs the package bin on import; http mounts the handler on `/mcp`. */
export function generateMcpEntry(transport: McpTransport): string {
  if (transport === "stdio") {
    return [
      `// Serves MCP over stdio. Configuration comes from STORYSHELF_URL / STORYSHELF_TOKEN / STORYSHELF_SLUG.`,
      `import "@storyshelf/mcp";`,
      ``,
    ].join("\n");
  }
  return [
    `import { serveHttp } from "@storyshelf/mcp/http";`,
    ``,
    `// Each MCP client sends its own "Authorization: Bearer <StoryShelf token>"; it is forwarded to /api/v1.`,
    `await serveHttp({`,
    `  url: process.env.STORYSHELF_URL!,`,
    `  slug: process.env.STORYSHELF_SLUG,`,
    `  port: Number(process.env.PORT) || 3333,`,
    `  host: process.env.HOST || "127.0.0.1",`,
    `});`,
    `console.error("storyshelf-mcp listening on /mcp");`,
    ``,
  ].join("\n");
}

/** `package.json` of the scaffolded project. */
export function generateMcpPackageJson(
  answers: McpScaffoldAnswers,
  devDependencies: Record<string, string>,
): string {
  return JSON.stringify(
    {
      name: answers.name,
      version: "0.1.0",
      type: "module",
      private: true,
      description: "StoryShelf MCP server.",
      engines: { node: ">=24" },
      scripts: { start: `node ${MCP_ENTRY}`, typecheck: "tsc" },
      dependencies: { "@storyshelf/mcp": __PKG_VERSION__ ?? "0.0.0" },
      devDependencies,
    },
    null,
    2,
  );
}

/** `.env.example`: never commit a real token. */
export function generateMcpEnvExample(answers: McpScaffoldAnswers): string {
  const transportLines =
    answers.transport === "stdio"
      ? [
          "# A project token with at least the viewer role (developer to post comments)",
          "STORYSHELF_TOKEN=",
        ]
      : [
          "# HTTP clients send their own Bearer token; no token is stored on this server",
          "PORT=3333",
          "HOST=0.0.0.0",
        ];
  const lines = [
    `STORYSHELF_URL=${answers.url}`,
    `STORYSHELF_SLUG=${answers.slug}`,
    ...transportLines,
  ];
  return `${lines.join("\n")}\n`;
}

// oxlint-disable-next-line no-template-curly-in-string -- literal client-side env interpolation
const TOKEN_REF = "${STORYSHELF_TOKEN}";

/** Client config for Claude Code (`.mcp.json`) and Cursor (`.cursor/mcp.json`). */
export function generateMcpClientConfig(answers: McpScaffoldAnswers): string {
  const server =
    answers.transport === "stdio"
      ? {
          command: "npx",
          args: ["-y", "@storyshelf/mcp"],
          env: {
            STORYSHELF_URL: answers.url,
            STORYSHELF_SLUG: answers.slug,
            STORYSHELF_TOKEN: TOKEN_REF,
          },
        }
      : {
          type: "http",
          url: "http://127.0.0.1:3333/mcp",
          headers: { Authorization: `Bearer ${TOKEN_REF}` },
        };
  return JSON.stringify({ mcpServers: { storyshelf: server } }, null, 2);
}

/** Small Node image for the HTTP transport (no browser needed). */
export function generateMcpDockerfile(): string {
  return [
    "FROM node:24-slim",
    "WORKDIR /app",
    "COPY package.json ./",
    "RUN npm install --omit=dev",
    "COPY src ./src",
    "ENV HOST=0.0.0.0 PORT=3333",
    "EXPOSE 3333",
    `CMD ["node", "${MCP_ENTRY}"]`,
    "",
  ].join("\n");
}
