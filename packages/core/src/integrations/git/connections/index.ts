/**
 * Server-wide git connections (ADR 0054): configuration, the GitHub App manifest flow, installation
 * lookup and health. The stored side is `GitConnectionModel` in `@storyshelf/core/models`.
 */
export { assertGitOptions, githubApp, gitlabGroup } from "./define.ts";
export {
  ENV_GITHUB_CONNECTION_ID,
  ENV_GITLAB_CONNECTION_ID,
  gitConfigFile,
  gitFromEnv,
} from "./env.ts";
export { exchangeManifestCode, type ExchangedApp } from "./exchange.ts";
export {
  GITLAB_EXPIRY_WARNING_DAYS,
  gitConnectionHealth,
  gitlabTokenExpiry,
  type GitConnectionHealth,
  type GitHealthOptions,
  type ProbedConnection,
} from "./health.ts";
export {
  resolveInstallation,
  type GitHubAppIdentity,
  type InstallationLookup,
} from "./installation.ts";
export {
  BROKEN_REASONS,
  recheckLink,
  resolveLinkCoverage,
  type LinkConnection,
  type LinkCoverage,
  type LinkRecheck,
  type LinkRepository,
} from "./link-host.ts";
export {
  githubAppManifest,
  manifestFormUrl,
  webHost,
  type AppManifestInput,
  type GitHubAppManifest,
} from "./manifest.ts";
export type {
  ConfiguredGitConnection,
  GitHubAppInput,
  GitHubAppPosts,
  GitLabGroupInput,
  GitLinkConfig,
  ShelfGitOptions,
} from "./types.ts";
