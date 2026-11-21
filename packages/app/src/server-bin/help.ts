/** `storyshelf-server --help`: the instance commands. Static text, so help loads nothing. */
export const SERVER_HELP = `Usage: storyshelf-server <command> [options]

Operate a StoryShelf instance. Run it in the instance project, with the instance's own
environment (a .env next to it is loaded; the shell's variables win). It reads no
.storybook/storyshelf.json.

Commands:
  serve           Start the instance (--port, default PORT or 3000; --watch restarts on changes)
  migrate         Run the database migrations and exit: setup of the database only (migrate, then roll)
  purge           Purge expired builds (--ttl-days)
  check-storage   Read-only: report blobs the database references but storage lacks
                  (--sample <n>; exits 1 when something is missing)
  doctor          Check the instance module, its settings and the schema level (no side effects)

purge, check-storage and doctor never migrate and start no job consumer, timer or replay.

Options:
  --dir <dir>     Instance project directory (default: the current directory)
  --entry <file>  The instance module, relative to --dir (default: "storyshelf": { "server": ... }
                  in package.json, then src/index.ts and the other usual names)
  -h, --help      Show this help
  -v, --version   Show the version

The instance module's default export is \`defineShelfInstance(async (env) => options)\` from
@storyshelf/app: configuration, never a constructed app. Project commands are in \`storyshelf\`.
`;
