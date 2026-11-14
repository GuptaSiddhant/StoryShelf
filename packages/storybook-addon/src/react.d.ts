/**
 * The slice of React the label uses. Declared here, not taken from `@types/react`, so the workspace
 * installs no second React: Storybook's manager supplies the real one at run time (`react` is one
 * of its externals), and the unit tests replace it with `react-fake.ts`.
 */
declare module "react" {
  export type ReactNode = unknown;
  export interface MouseEvent {
    preventDefault(): void;
    stopPropagation(): void;
  }
  export interface KeyboardEvent extends MouseEvent {
    key: string;
  }
  export function createElement(
    type: string | ((props: never) => ReactNode),
    props: object | null,
    ...children: unknown[]
  ): ReactNode;
  export function useSyncExternalStore<T>(
    subscribe: (listener: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T;
}
