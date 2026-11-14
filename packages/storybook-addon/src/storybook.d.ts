/**
 * The one slice of Storybook's manager API the addon uses. Declared here, not taken from the
 * `storybook` package, so the workspace installs no Storybook (it would bring its own Vite and a
 * second Vitest). It is a peer dependency; the fixture integration test loads the real one.
 */
declare module "storybook/manager-api" {
  export const addons: {
    setConfig(config: {
      sidebar: { renderLabel: (item: { id: string; type: string; name: string }) => unknown };
    }): void;
  };
}
