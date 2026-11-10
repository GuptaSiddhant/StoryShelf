import { createUrlBuilder, safeImageUrl } from "@storyshelf/core/urls";
import type { FC } from "hono/jsx";
import { getStore } from "../store.ts";
import { css } from "../ui/css.ts";
import { Dropdown, DropdownItem } from "../ui/dropdown.tsx";
import { Icon } from "../ui/icons/icon.tsx";
import { ThemeMenu, UserMenu } from "./account.tsx";
import {
  adminNavItems,
  helpNavItems,
  projectNavGroups,
  type NavConfig,
  type NavGroup,
  type NavItem,
} from "./nav.ts";
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
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
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
  .sidebar__group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .sidebar__group[data-folded] {
    display: none;
  }
  button.sidebar__section {
    appearance: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: calc(100% - 2 * var(--space-1));
    margin-inline: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
  }
  button.sidebar__section:hover {
    background: var(--surface-muted);
    color: var(--text-primary);
  }
  .sidebar__fold {
    flex: none;
    transition: transform var(--dur-fast) var(--ease);
  }
  button.sidebar__section[aria-expanded="false"] .sidebar__fold {
    transform: rotate(-90deg);
  }
  .sidebar__link {
    position: relative;
  }
  .sidebar__ext {
    margin-left: auto;
    opacity: 0.6;
  }
  .sidebar__footer {
    display: grid;
    gap: var(--space-1);
    padding-top: var(--space-2);
    border-top: 1px solid var(--border-subtle);
  }
  .sidebar__tools {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .sidebar__tools > details {
    flex: none;
    width: auto;
  }
  .sidebar__tools .sidebar__collapse {
    flex: 1;
    width: auto;
  }
  .sidebar__collapse {
    appearance: none;
    display: flex;
    align-items: center;
    gap: 0.65rem;
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
    html[data-sidebar="rail"] & .sidebar__group[data-folded] {
      display: flex;
    }
    html[data-sidebar="rail"] & .sidebar__link::after {
      content: attr(data-tooltip);
      position: absolute;
      left: calc(100% + var(--space-2));
      top: 50%;
      z-index: 70;
      transform: translateY(-50%);
      padding: 0.25rem 0.5rem;
      border-radius: var(--radius-sm);
      background: var(--text-primary);
      color: var(--surface-base);
      font-size: var(--text-sm);
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
    }
    html[data-sidebar="rail"] & .sidebar__link:hover::after,
    html[data-sidebar="rail"] & .sidebar__link:focus-visible::after {
      opacity: 1;
    }
    html[data-sidebar="rail"] & .sidebar__nav {
      overflow: visible;
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
    html[data-sidebar="rail"] & .sidebar__footer summary {
      justify-content: center;
    }
    html[data-sidebar="rail"] & .sidebar__footer summary > svg:last-child {
      display: none;
    }
    html[data-sidebar="rail"] & .sidebar__tools {
      flex-direction: column;
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
    & .sidebar__collapse {
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
      aria-label={item.label}
      data-tooltip={item.label}
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

/** A group heading that folds its entries; the choice is remembered by the client script. */
const NavSection: FC<{ group: NavGroup; active?: string }> = ({ group, active }) => {
  const panel = `nav-group-${group.id}`;
  return (
    <>
      <button
        type="button"
        class="sidebar__section"
        aria-expanded="true"
        aria-controls={panel}
        data-nav-fold={group.id}
      >
        <span>{group.title}</span>
        <span class="sidebar__fold">
          <Icon name="chevron-down" size="sm" />
        </span>
      </button>
      <div class="sidebar__group" id={panel} data-nav-group={group.id}>
        {group.items.map((item) => (
          <NavLink key={item.key} item={item} active={active} />
        ))}
      </div>
    </>
  );
};

/** Help menu (API docs, OpenAPI spec) beside the theme toggle. */
const HelpMenu: FC = () => (
  <Dropdown iconOnly placement="above" ariaLabel="Help" label={<Icon name="help-circle" />}>
    {helpNavItems().map((item) => (
      <DropdownItem
        key={item.key}
        href={item.href}
        icon={item.icon}
        target={item.external ? "_blank" : undefined}
        rel={item.external ? "noopener" : undefined}
      >
        {item.label}
      </DropdownItem>
    ))}
  </Dropdown>
);

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

/** Account, theme and help menus, and the collapse toggle. */
const SidebarFooter: FC = () => (
  <div class="sidebar__footer">
    <UserMenu />
    <div class="sidebar__tools">
      <ThemeMenu />
      <HelpMenu />
      <button
        class="sidebar__collapse"
        type="button"
        data-sidebar-collapse
        aria-label="Collapse or expand sidebar"
        title="Collapse or expand sidebar"
      >
        <Icon name="chevrons-left" />
        <span class="sidebar__label">Collapse</span>
      </button>
    </div>
  </div>
);

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
        {nav?.projectSlug
          ? projectNavGroups(urls, nav.projectSlug).map((group) => (
              <NavSection key={group.id} group={group} active={nav.active} />
            ))
          : null}
        {showAdmin ? (
          <NavSection
            group={{ id: "admin", title: "Administration", items: adminNavItems() }}
            active={nav?.active}
          />
        ) : null}
      </nav>
      <SidebarFooter />
    </aside>
  );
};
