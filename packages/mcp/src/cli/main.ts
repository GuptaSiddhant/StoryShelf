import { parseArgs } from "node:util";

/** The subcommands of the bin beyond serving MCP itself. */
export const MCP_SUBCOMMANDS = ["init", "serve"] as const;

/** `init` or `serve` when `argv` starts with one, else undefined (the bin serves MCP itself). */
export function subcommandOf(
  argv: readonly string[],
): (typeof MCP_SUBCOMMANDS)[number] | undefined {
  return MCP_SUBCOMMANDS.find((name) => name === argv[0]);
}

/** Run `storyshelf-mcp init [--dir]` or `storyshelf-mcp serve [--dir --url --slug --token --port]`. */
export async function runSubcommand(
  name: (typeof MCP_SUBCOMMANDS)[number],
  argv: readonly string[],
): Promise<void> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      dir: { type: "string" },
      url: { type: "string" },
      slug: { type: "string" },
      token: { type: "string" },
      port: { type: "string" },
    },
  });
  if (name === "init") {
    const { runMcpInit } = await import("./init.ts");
    await runMcpInit(values.dir === undefined ? {} : { dir: values.dir });
    return;
  }
  const { runMcpServe } = await import("./serve.ts");
  await runMcpServe(values);
}
