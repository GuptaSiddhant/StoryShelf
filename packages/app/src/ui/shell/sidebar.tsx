import { createUrlBuilder, safeImageUrl } from "@storyshelf/core/urls";
import type { FC } from "hono/jsx";
import { getStore } from "../../store.ts";
import { css } from "../css.ts";
import { Icon } from "../icons/icon.tsx";
import {
  adminNavItems,
  developerNavItems,
  projectNavItems,
  type NavConfig,
  type NavItem,
} from "./nav.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/**
 * Left rail. Collapses to icons only on desktop (`html[data-sidebar="rail"]`)
 * and becomes an off-canvas drawer on small screens.
 */
const shellSidebar = css`
  /* shell-sidebar */
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-2);
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  overflow-x: hidden;
  .sidebar__brand {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 40px;
    padding: 0 var(--space-2);
    color: var(--text-primary);
    font-weight: 650;
    font-size: var(--text-lg);
    letter-spacing: -0.01em;
    text-decoration: none;
  }
  .sidebar__brand:hover {
    text-decoration: none;
  }
  .sidebar__mark {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--accent-contrast);
  }
  .sidebar__logo {
    flex: none;
    border-radius: var(--radius-sm);
    object-fit: contain;
  }
  .sidebar__nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }
  .sidebar__section {
    margin: var(--space-4) 0 var(--space-1);
    padding: 0 var(--space-3);
    color: var(--text-secondary);
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .sidebar__link {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-height: 38px;
    padding: 0.4rem var(--space-3);
    border-radius: var(--radius);
    color: var(--text-secondary);
    font-size: var(--text-base);
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
    transition:
      background var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease);
  }
  .sidebar__link:hover {
    background: var(--surface-muted);
    color: var(--text-primary);
    text-decoration: none;
  }
  .sidebar__link--active {
    background: var(--accent-subtle);
    color: var(--accent-fg);
    font-weight: 600;
  }
  .sidebar__link--active:hover {
    background: var(--accent-subtle);
    color: var(--accent-fg);
  }
  .sidebar__link--active svg {
    color: var(--accent);
  }
  .sidebar__ext {
    margin-left: auto;
    opacity: 0.6;
  }
  .sidebar__footer {
    display: flex;
    padding-top: var(--space-2);
    border-top: 1px solid var(--border-subtle);
  }
  .sidebar__collapse {
    appearance: none;
    display: flex;
    align-items: center;
    gap: 0.65rem;
    width: 100%;
    min-height: 36px;
    padding: 0.4rem var(--space-3);
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .sidebar__collapse:hover {
    background: var(--surface-muted);
    color: var(--text-primary);
  }
  @media (min-width: 881px) {
    html[data-sidebar="rail"] & .sidebar__label,
    html[data-sidebar="rail"] & .sidebar__section,
    html[data-sidebar="rail"] & .sidebar__ext {
      display: none;
    }
    html[data-sidebar="rail"] & .sidebar__link,
    html[data-sidebar="rail"] & .sidebar__collapse,
    html[data-sidebar="rail"] & .sidebar__brand {
      justify-content: center;
      padding-inline: 0;
    }
    html[data-sidebar="rail"] & .sidebar__collapse svg {
      transform: rotate(180deg);
    }
  }
  @media (max-width: 880px) {
    & {
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 60;
      width: min(280px, 85vw);
      height: 100dvh;
      transform: translateX(-100%);
      transition: transform var(--dur-base) var(--ease);
      box-shadow: var(--shadow-3);
    }
    &.sidebar--open {
      transform: translateX(0);
    }
    & .sidebar__footer {
      display: none;
    }
  }
`;

const NavLink: FC<{ item: NavItem; active?: string }> = ({ item, active }) => {
  const current = active === item.key;
  return (
    <a
      class={`sidebar__link${current ? " sidebar__link--active" : ""}`}
      href={item.href}
      title={item.label}
      aria-current={current ? "page" : undefined}
      target={item.external ? "_blank" : undefined}
      rel={item.external ? "noopener" : undefined}
    >
      <Icon name={item.icon} />
      <span class="sidebar__label">{item.label}</span>
      {item.external ? (
        <span class="sidebar__ext">
          <Icon name="external-link" size="sm" />
        </span>
      ) : null}
    </a>
  );
};

const NavSection: FC<{ title: string; items: NavItem[]; active?: string }> = ({
  title,
  items,
  active,
}) => {
  return (
    <>
      <div class="sidebar__section">{title}</div>
      {items.map((item) => (
        <NavLink key={item.key} item={item} active={active} />
      ))}
    </>
  );
};

const Brand: FC<{ name: string; logo?: string; href: string }> = ({ name, logo, href }) => {
  const safeLogo = safeImageUrl(logo);
  return (
    <a class="sidebar__brand" href={href} title={name}>
      {safeLogo ? (
        <img class="sidebar__logo" src={safeLogo} alt="" width="28" height="28" />
      ) : (
        <span class="sidebar__mark" aria-hidden="true">
          <Icon name="layers" size="sm" />
        </span>
      )}
      <span class="sidebar__label">{name}</span>
    </a>
  );
};

/** Primary navigation: brand, workspace, project, developer, and admin entries. */
export const Sidebar: FC<{ nav?: NavConfig; name: string; logo?: string }> = ({
  nav,
  name,
  logo,
}) => {
  const { user, authEnabled, config } = getStore();
  const urls = createUrlBuilder("/", config.publishedBaseDomain);
  const showAdmin = !authEnabled || user?.role === "admin";
  const projects: NavItem = {
    key: "projects",
    label: "Projects",
    href: urls.projects(),
    icon: "folder",
  };
  return (
    <aside id="sidebar" class={shellSidebar} aria-label="Primary" data-sidebar>
      <Brand name={name} logo={logo} href={urls.projects()} />
      <nav class="sidebar__nav">
        <NavLink item={projects} active={nav?.active} />
        {nav?.projectSlug ? (
          <NavSection
            title="Project"
            items={projectNavItems(urls, nav.projectSlug)}
            active={nav.active}
          />
        ) : null}
        <NavSection title="Developer" items={developerNavItems()} active={nav?.active} />
        {showAdmin ? (
          <NavSection title="Administration" items={adminNavItems()} active={nav?.active} />
        ) : null}
      </nav>
      <div class="sidebar__footer">
        <button class="sidebar__collapse" type="button" data-sidebar-collapse>
          <Icon name="chevrons-left" />
          <span class="sidebar__label">Collapse</span>
        </button>
      </div>
    </aside>
  );
};
