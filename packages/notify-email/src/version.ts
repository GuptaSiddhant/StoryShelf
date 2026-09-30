declare const __PKG_VERSION__: string | undefined;

/** Package version injected at build via __PKG_VERSION__. */
export function version(): string {
  return (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0";
}
