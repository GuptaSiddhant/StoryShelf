/** `storyshelf-server --help`: the instance commands. Static text, so help loads nothing. */
export const SERVER_HELP = `Usage: storyshelf-server <command> [options]

Operate a StoryShelf instance. Run it in the instance project (the one that creates the app),
with the instance's own environment: it reads no .storybook/storyshelf.json.

Commands:
  serve           Start the instance (--port, default PORT or 3000)
  migrate         Run the database migrations and adapter setup, then exit (migrate, then roll)
  purge           Purge expired builds (--ttl-days; needs SHELF_ADMIN_TOKEN)
  check-storage   Read-only: report blobs the database references but storage lacks
                  (--sample <n>; needs SHELF_ADMIN_TOKEN; exits 1 when something is missing)
  doctor          Check the instance's module, adapters and settings (no side effects)

Options:
  --dir <dir>     Instance project directory (default: the current directory)
  -h, --help      Show this help
  -v, --version   Show the version

The instance module is src/index.ts (or .js/.mjs, server.*, index.*) and exports the app
(\`export default createShelfApp({ ... })\`). Project commands (upload, build, ...) are in \`storyshelf\`.
`;
