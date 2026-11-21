/** The `--wait` exit codes as `storyshelf upload --help` prints them (kept apart so help loads no client code). */
export const WAIT_EXIT_HELP = [
  "Exit codes with --wait:",
  "  0  approved (including no changes, a skipped build, or a hosting-only build accepted on publish)",
  "  2  changes need review, or the Storybook is published and waits for a verdict",
  "  3  rejected",
  "  4  failed (including a failing Storybook test)",
  "  5  cancelled, including superseded by a newer build",
  "  6  --timeout reached while the build still ran; nothing was cancelled",
  "  1  the CLI itself failed (config, network, auth, the upload)",
].join("\n");
