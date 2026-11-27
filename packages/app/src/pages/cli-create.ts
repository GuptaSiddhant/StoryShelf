import { getStore } from "../store.ts";

/**
 * `storyshelf create` can make a project only with an admin token, or with sign-in off. On a
 * default install sign-in is on and no admin token is set, so pages lead with "Create project".
 */
export function cliCreateAvailable(): boolean {
  const { authEnabled, config } = getStore();
  return !authEnabled || Boolean(config.adminToken);
}

/** With sign-in on, the home page leads with "Create project", whether or not the CLI could do it. */
export function leadWithCreateProject(): boolean {
  return getStore().authEnabled;
}
