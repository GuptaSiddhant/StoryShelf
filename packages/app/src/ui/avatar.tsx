import type { FC } from "hono/jsx";
import { css } from "./css.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type AvatarSize = "sm" | "md" | "lg";

const avatarBase = css`
  /* avatar */
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--radius-pill);
  background: var(--accent-subtle);
  color: var(--accent-fg);
  border: 1px solid var(--accent-border);
  font-size: var(--text-xs);
  font-weight: 650;
  line-height: 1;
  overflow: hidden;
  object-fit: cover;
  user-select: none;
`;

const avatarSm = css`
  /* avatar-sm */
  ${avatarBase}
  width: 1.375rem;
  height: 1.375rem;
  font-size: 0.65rem;
`;

const avatarLg = css`
  /* avatar-lg */
  ${avatarBase}
  width: 2.5rem;
  height: 2.5rem;
  font-size: var(--text-base);
`;

const avatarSizes: Record<AvatarSize, Promise<string>> = {
  sm: avatarSm,
  md: avatarBase,
  lg: avatarLg,
};

const avatarGroup = css`
  /* avatar-group */
  display: inline-flex;
  & > * + * {
    margin-left: -0.4rem;
    box-shadow: 0 0 0 2px var(--surface-card);
  }
`;

/** Up to two initials from a display name or email. */
export function initials(name: string): string {
  const parts = name
    .replace(/@.*$/u, "")
    .split(/[\s._-]+/u)
    .filter((part) => part.length > 0);
  const first = parts[0];
  const last = parts.at(-1);
  if (first === undefined || last === undefined) {
    return "";
  }
  const letters = parts.length > 1 ? `${first.slice(0, 1)}${last.slice(0, 1)}` : first.slice(0, 2);
  return letters.toUpperCase();
}

/** Round user image, falling back to tinted initials (the brand accent shows subtly). */
export const Avatar: FC<{ name: string; src?: string | null; size?: AvatarSize }> = ({
  name,
  src,
  size = "md",
}) => {
  if (src) {
    return <img class={avatarSizes[size]} src={src} alt={name} loading="lazy" />;
  }
  return (
    <span class={avatarSizes[size]} role="img" aria-label={name}>
      {initials(name) || "?"}
    </span>
  );
};

/** Overlapping avatars for a list of people. */
export const AvatarGroup: FC<{ children?: unknown }> = ({ children }) => {
  return <span class={avatarGroup}>{children}</span>;
};
