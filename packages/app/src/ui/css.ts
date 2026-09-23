/**
 * hono/css building blocks for the server-rendered UI.
 *
 * A single custom context so every family module shares one `<style>`
 * tag (mounted in `DocumentLayout`) and one readable naming scheme:
 * start each `css` template with a label comment and it becomes the
 * class-name prefix (`ss-btn-<hash>`). Unlabeled templates fall back to
 * the default `css-<hash>`.
 *
 * Rules (enforced by `ui/consistency.test.ts`, see the `ui-building-blocks`
 * skill for the full contract):
 * - Import `css`/`cx`/`Style` from here, never from `hono/css` directly.
 * - One `css` template per variant; compose via `${base}` extension so the
 *   label (and readable class name) survives. Do NOT compose variants with
 *   `cx` — it merges styles into a new unlabeled `css-<hash>` class.
 * - Pseudo-states via `&` nesting inside the template.
 * - Never interpolate runtime values (brand tokens stay as CSS vars in
 *   the global token `<style>` tag). Static maps only.
 */
import { createCssContext } from "hono/css";
import type { HtmlEscapedString } from "hono/utils/html";

/** Values allowed inside a `css` template (static only, never user input). */
export type CssValue = string | number | false | null | undefined | Promise<string>;

/** A `css` template function with a publicly nameable type (see below). */
export type CssTemplate = (strings: TemplateStringsArray, ...values: CssValue[]) => Promise<string>;

/** Class-name composer with a publicly nameable type (see below). */
export type CxFn = (
  ...args: Array<string | boolean | null | undefined | Promise<string>>
) => Promise<string>;

/** The `<Style />` tag with a publicly nameable type (see below). */
export type StyleTag = (args?: { children?: Promise<string>; nonce?: string }) => HtmlEscapedString;

const context = createCssContext({
  id: "storyshelf-css",
  classNameSlug: (hash, label) => (label ? `ss-${label}-${hash}` : hash),
});

// Thin wrappers (not direct re-exports): hono/css declares its function
// types via private names, which `tsc --noEmit` rejects under
// `declaration: true` (TS4023). These annotations keep the public surface
// nameable while returning the identical runtime objects.
/** Create a labeled, hashed class for a static declaration block. */
// eslint-disable-next-line promise-function-async -- thin typed wrapper returning hono/css's own promise
export const css: CssTemplate = (strings, ...values) => context.css(strings, ...values);

/** Compose classes and conditional values (falsy-safe). */
// eslint-disable-next-line promise-function-async -- thin typed wrapper returning hono/css's own promise
export const cx: CxFn = (...args) => context.cx(...args);

/** Collects every used class into `<style id="storyshelf-css">`. */
export const Style: StyleTag = (args) => context.Style(args);
