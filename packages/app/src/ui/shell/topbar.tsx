import { ProjectModel } from "@storyshelf/core/models";
import { createUrlBuilder, safeImageUrl } from "@storyshelf/core/urls";
import type { FC } from "hono/jsx";
import { getStore } from "../../store.ts";
import { Avatar } from "../avatar.tsx";
import { Button } from "../buttons.tsx";
import { csrfField } from "../csrf-field.tsx";
import { css } from "../css.ts";
import { Dropdown, DropdownDivider, DropdownItem } from "../dropdown.tsx";
import { Icon } from "../icons/icon.tsx";
import type { NavConfig } from "./nav.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** Slim, translucent bar above the page content (no brand color flood). */
const shellTopbar = css`
  /* shell-topbar */
  position: sticky;
  top: 0;
  z-index: 40;
  height: var(--topbar-height);
  background: color-mix(in srgb, var(--surface-base) 86%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border);
  .topbar__inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    height: 100%;
    padding: 0 var(--space-6);
  }
  .topbar__left,
  .topbar__right {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .topbar__menu {
    display: none;
  }
  .topbar__user-name {
    max-width: 14ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .topbar__user-meta {
    padding: 0.4rem 0.6rem 0.5rem;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    line-height: 1.3;
  }
  .topbar__user-meta strong {
    display: block;
    color: var(--text-primary);
    font-size: var(--text-base);
  }
  .topbar__logout {
    margin: 0;
  }
  @media (max-width: 880px) {
    & .topbar__inner {
      padding: 0 var(--space-4);
    }
    & .topbar__menu {
      display: inline-flex;
    }
    & .topbar__user-name {
      display: none;
    }
  }
`;

const toastRegion = css`
  /* toast-region */
  position: fixed;
  top: calc(var(--topbar-height) + var(--space-3));
  right: var(--space-4);
  z-index: 80;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: min(360px, calc(100vw - 2rem));
  pointer-events: none;
  .toast {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-card);
    box-shadow: var(--shadow-3);
    font-size: var(--text-base);
    pointer-events: auto;
    animation: toast-in var(--dur-base) var(--ease);
  }
  .toast svg {
    margin-top: 0.1rem;
  }
  .toast[data-tone="success"] svg {
    color: var(--status-approved);
  }
  .toast[data-tone="danger"] svg {
    color: var(--status-rejected);
  }
  .toast[data-tone="warning"] svg {
    color: var(--status-new);
  }
  .toast[data-tone="info"] svg {
    color: var(--accent);
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
  }
`;

interface SwitcherProject {
  slug: string;
  name: string;
}

async function listProjects(): Promise<SwitcherProject[]> {
  try {
    const projects = await new ProjectModel(getStore().db).list();
    return projects.map((project) => ({ slug: project.slug, name: project.name }));
  } catch {
    // The switcher is a convenience; never fail a page render over it.
    return [];
  }
}

/** Dropdown to jump between projects; falls back to the current one if listing fails. */
const ProjectSwitcher: FC<{ nav: NavConfig }> = async ({ nav }) => {
  const { user, config } = getStore();
  const urls = createUrlBuilder("/", config.publishedBaseDomain);
  const projects = await listProjects();
  const canCreate = !user || user.role === "admin" || user.role === "member";
  const label = nav.projectName ?? nav.projectSlug ?? "Project";
  return (
    <Dropdown
      ariaLabel={`Project: ${label}`}
      label={
        <>
          <Icon name="folder" size="sm" />
          <span>{label}</span>
        </>
      }
    >
      {projects.map((project) => (
        <DropdownItem
          key={project.slug}
          href={urls.library(project.slug)}
          current={project.slug === nav.projectSlug}
        >
          {project.name}
        </DropdownItem>
      ))}
      {projects.length > 0 ? <DropdownDivider /> : null}
      <DropdownItem href={urls.projects()} icon="folder">
        All projects
      </DropdownItem>
      {canCreate ? (
        <DropdownItem href={urls.projectsNew()} icon="plus">
          New project
        </DropdownItem>
      ) : null}
    </Dropdown>
  );
};

/** Light / Dark / System menu; the trigger shows the active mode's icon. */
const ThemeMenu: FC = () => {
  return (
    <span class="topbar__theme">
      <Dropdown
        align="end"
        iconOnly
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
    </span>
  );
};

const UserMenu: FC = () => {
  const { user, authEnabled } = getStore();
  if (!authEnabled) {
    return null;
  }
  if (!user) {
    return (
      <Button href="/auth/login" size="sm">
        Sign in
      </Button>
    );
  }
  return (
    <Dropdown
      align="end"
      ariaLabel="Account"
      label={
        <>
          <Avatar name={user.name} src={safeImageUrl(user.avatarUrl)} size="sm" />
          <span class="topbar__user-name">{user.name}</span>
        </>
      }
    >
      <div class="topbar__user-meta">
        <strong>{user.name}</strong>
        {user.role}
      </div>
      <DropdownDivider />
      <DropdownItem href="/profile" icon="user">
        Profile
      </DropdownItem>
      <form class="topbar__logout" method="post" action="/auth/logout">
        {csrfField()}
        <DropdownItem type="submit" icon="log-out">
          Sign out
        </DropdownItem>
      </form>
    </Dropdown>
  );
};

/** Top bar: mobile menu button, project switcher, theme menu, and account menu. */
export const TopBar: FC<{ nav?: NavConfig }> = ({ nav }) => {
  return (
    <header class={shellTopbar} role="banner">
      <div class="topbar__inner">
        <div class="topbar__left">
          <span class="topbar__menu">
            <Button
              variant="ghost"
              icon="menu"
              aria-label="Toggle navigation"
              aria-expanded="false"
              aria-controls="sidebar"
              data-sidebar-toggle
            />
          </span>
          {nav?.projectSlug ? <ProjectSwitcher nav={nav} /> : null}
        </div>
        <div class="topbar__right">
          <ThemeMenu />
          <UserMenu />
        </div>
      </div>
    </header>
  );
};

/** Live region the client script appends toasts to (see `toast.ts`). */
export const ToastRegion: FC = () => {
  return <div class={toastRegion} data-toast-region aria-live="polite" aria-atomic="false" />;
};
