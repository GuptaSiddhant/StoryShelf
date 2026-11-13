/** Package version for provider metadata. */
declare const __PKG_VERSION__: string | undefined;

/** The package version injected at build time (tsdown `define`), `0.0.0` in tests. */
export function packageVersion(): string {
  return typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0";
}
