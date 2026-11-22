declare const __PKG_VERSION__: string | undefined;

/**
 * This package's version, injected at build via the `__PKG_VERSION__` define (read as a bare
 * identifier: bundler defines replace identifiers, not `globalThis` members). Undefined when running
 * from source, so a Terraform stub then pins no release.
 */
export function packageVersion(): string | undefined {
  if (typeof __PKG_VERSION__ !== "string") return undefined;
  return __PKG_VERSION__ === "" || __PKG_VERSION__ === "0.0.0" ? undefined : __PKG_VERSION__;
}
