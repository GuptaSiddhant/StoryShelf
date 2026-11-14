declare const __PKG_VERSION__: string | undefined;

/**
 * Package version injected at build via the `__PKG_VERSION__` define. Read as a bare identifier:
 * bundler defines replace identifiers, not `globalThis` property reads. Undefined when running
 * from source (dev server, tests).
 */
export function packageVersion(): string {
  return typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0";
}
