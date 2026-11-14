/**
 * The one module that names Storybook's manager API. Storybook 9 and 10 externalize it as
 * `storybook/manager-api`; 8.6 as `@storybook/manager-api`, which the build's `legacy` output
 * substitutes (see `tsdown.config.ts`). Nothing else imports either name.
 */
export { addons } from "storybook/manager-api";
