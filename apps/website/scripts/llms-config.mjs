// Shared by markdown-export.mjs (writes the files) and check-llms.mjs (checks them).

/** About four characters to a token: the budgets are in tokens, the checks measure characters. */
export const CHARS_PER_TOKEN = 4;

/**
 * The section bundles written next to `llms-full.txt`. `groups` are sidebar group labels; `pages`
 * are extra page paths; `exclude` drops pages that would not fit. `budget` is in tokens (`llms-start.txt` has to stay small enough for an
 * agent to read before it starts working).
 */
export const BUNDLES = [
  {
    file: "llms-start.txt",
    title: "StoryShelf: start here",
    about: "Start here, Concepts and the CLI: enough to set StoryShelf up in a repository.",
    groups: ["Start here", "Concepts", "CLI & changelog"],
    // Long or specialised pages, still one link away in llms.txt: the budget leaves no room. A new page in these groups can push the bundle over: add it here or shorten something, as check-llms.mjs says.
    exclude: [
      "/guides/chromatic-comparison/",
      "/guides/chromatic-migration/",
      "/guides/lost-pixel-migration/",
      "/concepts/capture/",
      "/concepts/affected-capture/",
      "/concepts/publishing/",
      "/concepts/how-storybook-works/",
      "/concepts/retention/",
      "/concepts/hosting-only/",
      "/concepts/labels/",
      "/guides/support/",
      "/guides/demo/",
    ],
    budget: 20_000,
  },
  {
    file: "llms-deploy.txt",
    title: "StoryShelf: deployment and operations",
    about:
      "Running a StoryShelf server: deployment, sizing, configuration, secrets, observability.",
    groups: ["Deploy & operate"],
    // A one-off migration guide and the three per-cloud pages (module inputs, permissions, costs), one link away in llms.txt: the budget leaves no room.
    exclude: [
      "/guides/deployment/migrate-terraform/",
      "/guides/deployment/aws/",
      "/guides/deployment/gcp/",
      "/guides/deployment/azure/",
    ],
    budget: 25_000,
  },
  {
    file: "llms-api.txt",
    title: "StoryShelf: API and MCP",
    about: "The REST API guide, webhooks and the MCP server. The endpoints are in openapi.json.",
    groups: [],
    pages: ["/guides/api/", "/guides/webhooks/", "/ai/mcp/"],
    budget: 15_000,
  },
];

/** The file that carries every page, and its budget in tokens. */
export const FULL = { file: "llms-full.txt", budget: 200_000 };
