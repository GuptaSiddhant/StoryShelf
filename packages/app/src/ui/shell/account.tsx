import { safeImageUrl } from "@storyshelf/core/urls";
import type { FC } from "hono/jsx";
import { getStore } from "../../store.ts";
import { Avatar } from "../avatar.tsx";
import { Button } from "../buttons.tsx";
import { csrfField } from "../csrf-field.tsx";
import { css } from "../css.ts";
import { Dropdown, DropdownDivider, DropdownItem } from "../dropdown.tsx";
import { Icon } from "../icons/icon.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** Styles for the account widgets that live in the sidebar footer. */
const accountRoot = css`
  /* account */
  display: grid;
  gap: var(--space-1);
  .account__who {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .account__text {
    display: grid;
    min-width: 0;
    text-align: left;
    line-height: 1.2;
  }
  .account__name {
    overflow: hidden;
    font-size: var(--text-base);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .account__role {
    color: var(--text-secondary);
    font-size: var(--text-xs);
    text-transform: capitalize;
  }
  .account__meta {
    padding: 0.4rem 0.6rem 0.5rem;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    line-height: 1.3;
  }
  .account__meta strong {
    display: block;
    color: var(--text-primary);
    font-size: var(--text-base);
  }
  .account__logout {
    margin: 0;
  }
`;

/** Light / Dark / System menu; the trigger shows the active mode's icon. */
export const ThemeMenu: FC = () => {
  return (
    <Dropdown
      iconOnly
      placement="above"
      ariaLabel="Theme"
      label={
        <>
          <span data-theme-icon="light">
            <Icon name="sun" />
          </span>
          <span data-theme-icon="dark">
            <Icon name="moon" />
          </span>
          <span data-theme-icon="system">
            <Icon name="monitor" />
          </span>
        </>
      }
    >
      <DropdownItem icon="sun" data-theme-set="light">
        Light
      </DropdownItem>
      <DropdownItem icon="moon" data-theme-set="dark">
        Dark
      </DropdownItem>
      <DropdownItem icon="monitor" data-theme-set="system">
        System
      </DropdownItem>
    </Dropdown>
  );
};

/** Signed-in user row (name, role, profile, sign out); a sign-in button when signed out. */
export const UserMenu: FC = () => {
  const { user, authEnabled } = getStore();
  if (!authEnabled) {
    return null;
  }
  if (!user) {
    return (
      <Button href="/auth/login" size="sm" icon="user">
        <span class="sidebar__label">Sign in</span>
      </Button>
    );
  }
  return (
    <div class={accountRoot}>
      <Dropdown
        block
        placement="above"
        ariaLabel={`Account: ${user.name}`}
        label={
          <span class="account__who">
            <Avatar name={user.name} src={safeImageUrl(user.avatarUrl)} size="sm" />
            <span class="account__text sidebar__label">
              <span class="account__name">{user.name}</span>
              <span class="account__role">{user.role}</span>
            </span>
          </span>
        }
      >
        <div class="account__meta">
          <strong>{user.name}</strong>
          {user.role}
        </div>
        <DropdownDivider />
        <DropdownItem href="/profile" icon="user">
          Profile
        </DropdownItem>
        <form class="account__logout" method="post" action="/auth/logout">
          {csrfField()}
          <DropdownItem type="submit" icon="log-out">
            Sign out
          </DropdownItem>
        </form>
      </Dropdown>
    </div>
  );
};
