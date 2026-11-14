/** A stand-in for `react` in unit tests: elements are plain objects and hooks read their snapshot. */

/** What the fake `createElement` returns. */
export interface FakeElement {
  type: unknown;
  props: Record<string, unknown>;
  children: unknown[];
}

export function createElement(
  type: unknown,
  props: Record<string, unknown> | null,
  ...children: unknown[]
): FakeElement {
  return { type, props: props ?? {}, children };
}

export function useSyncExternalStore<T>(_subscribe: unknown, getSnapshot: () => T): T {
  return getSnapshot();
}

/** Resolve a fake element to what it renders: function components are called, strings stay. */
export function resolve(node: unknown): unknown {
  if (typeof node !== "object" || node === null || !("type" in node)) return node;
  const element = node as FakeElement;
  return typeof element.type === "function"
    ? resolve((element.type as (props: unknown) => unknown)(element.props))
    : element;
}

/** The visible text of a resolved fake element: its strings and its children's, in order. */
export function textOf(node: unknown): string {
  const resolved = resolve(node);
  if (typeof resolved === "string") return resolved;
  if (typeof resolved !== "object" || resolved === null) return "";
  return (resolved as FakeElement).children.map((child) => textOf(child)).join("");
}
