import type { FC } from "hono/jsx";
import { css } from "../css.ts";
import type { IconName } from "./paths.ts";
import { iconHref } from "./sprite.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type IconSize = "sm" | "md" | "lg";

const iconBase = css`
  /* icon */
  flex: none;
  width: 1.125rem;
  height: 1.125rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  vertical-align: -0.2em;
`;

const iconSm = css`
  /* icon-sm */
  ${iconBase}
  width: 0.875rem;
  height: 0.875rem;
`;

const iconLg = css`
  /* icon-lg */
  ${iconBase}
  width: 1.5rem;
  height: 1.5rem;
`;

const iconSizes: Record<IconSize, Promise<string>> = { sm: iconSm, md: iconBase, lg: iconLg };

/**
 * Decorative icon from the cached sprite. Pass `label` when the icon is the
 * only content of a control; otherwise it is hidden from assistive tech.
 */
export const Icon: FC<{ name: IconName; size?: IconSize; label?: string }> = ({
  name,
  size = "md",
  label,
}) => {
  return (
    <svg
      class={iconSizes[size]}
      viewBox="0 0 24 24"
      aria-hidden={label ? undefined : "true"}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
    >
      <use href={iconHref(name)} />
    </svg>
  );
};
