import type { StorybookConfig } from "@storybook/html-vite";
import { fileURLToPath } from "node:url";

/** One entry of Vite's `resolve.alias` list. */
interface Alias {
  find: string | RegExp;
  replacement: string;
}

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * Storybook for the app's own UI: every shared component and the key pages, rendered from the
 * real hono/jsx sources. The browser bundle swaps three server-only modules for story-only shims
 * (see `shims/`); production code is never branched.
 */
const config: StorybookConfig = {
  framework: "@storybook/html-vite",
  stories: ["../src/**/*.stories.tsx"],
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  viteFinal: (viteConfig) => {
    const aliases = [
      {
        find: /^\.{1,2}\/(?:[^\n]*\/)?(?<!shims\/)sprite\.ts$/u,
        replacement: here("./shims/sprite.ts"),
      },
      { find: /^(?:\.{1,2}\/)+store\.ts$/u, replacement: here("./shims/store.ts") },
      { find: /^(?:sharp|unzipper|pngjs|graceful-fs)$/u, replacement: here("./shims/inert.ts") },
      {
        find: /^node:(?:[a-z_]+(?:\/[a-z]+)?)$/u,
        replacement: here("./shims/node-builtins.ts"),
      },
      {
        // The package barrel also holds the contract suites (which import vitest): stories need
        // only the in-memory database.
        find: "@storyshelf/core/test-helpers",
        replacement: here("../../core/src/test-helpers/fake-database.ts"),
      },
      { find: /^(?:\.{1,2}\/)+middleware\/csrf\.ts$/u, replacement: here("./shims/csrf.ts") },
    ];
    const existing = viteConfig.resolve?.alias as Alias[] | Record<string, string> | undefined;
    const current: Alias[] = Array.isArray(existing)
      ? existing
      : Object.entries(existing ?? {}).map(([find, replacement]) => ({ find, replacement }));
    return {
      ...viteConfig,
      resolve: { ...viteConfig.resolve, alias: [...aliases, ...current] },
      // One bundle holds every story and the app's UI code: the size is expected, not a warning.
      build: { ...viteConfig.build, chunkSizeWarningLimit: 4000 },
    };
  },
};

export default config;
