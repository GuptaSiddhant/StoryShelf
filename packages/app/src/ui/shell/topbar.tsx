import { ProjectModel } from "@storyshelf/core/models";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { FC } from "hono/jsx";
import { getStore } from "../../store.ts";
import { Button } from "../buttons.tsx";
import { css } from "../css.ts";
import { Dropdown, DropdownDivider, DropdownItem } from "../dropdown.tsx";
import { Icon } from "../icons/icon.tsx";
import { breadcrumbs, type NavConfig, type NavCrumb } from "./nav.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** Slim, translucent bar: project picker plus breadcrumbs (account lives in the sidebar). */
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
  .topbar__left {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    flex: 1;
    overflow: visible;
  }
  .topbar__menu {
    display: none;
  }
  .topbar__left nav {
    min-width: 0;
  }
  .topbar__picker {
    overflow: hidden;
    max-width: 26ch;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .crumbs {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--text-secondary);
    font-size: var(--text-base);
  }
  .crumbs li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .crumbs li::before {
    content: "›";
    color: var(--text-muted);
  }
  .crumbs a {
    overflow: hidden;
    max-width: 28ch;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .crumbs a:hover {
    color: var(--text-primary);
    text-decoration: none;
  }
  @media (max-width: 880px) {
    & .topbar__inner {
      padding: 0 var(--space-4);
    }
    & .topbar__menu {
      display: inline-flex;
    }
    & .crumbs li:not(:last-child) {
      display: none;
    }
    & .crumbs li:last-child::before {
      content: "‹";
    }
    & .crumbs a {
      max-width: 100%;
    }
    & .topbar__picker {
      max-width: 14ch;
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

interface PickerProject {
  slug: string;
  name: string;
}

async function listProjects(): Promise<PickerProject[]> {
  try {
    const projects = await new ProjectModel(getStore().db).list();
    return projects.map((project) => ({ slug: project.slug, name: project.name }));
  } catch {
    // The picker is a convenience; never fail a page render over it.
    return [];
  }
}

/** Dropdown to jump between projects; on global pages it reads "All projects". */
const ProjectPicker: FC<{ nav?: NavConfig }> = async ({ nav }) => {
  const { user, config } = getStore();
  const urls = createUrlBuilder("/", config.publishedBaseDomain);
  const projects = await listProjects();
  const canCreate = !user || user.role === "admin" || user.role === "member";
  const current = nav?.projectSlug;
  const label = current ? (nav?.projectName ?? current) : "All projects";
  return (
    <Dropdown
      ariaLabel={`Project: ${label}`}
      label={
        <>
          <Icon name="folder" size="sm" />
          <span class="topbar__picker">{label}</span>
        </>
      }
    >
      {projects.map((project) => (
        <DropdownItem
          key={project.slug}
          href={urls.library(project.slug)}
          current={project.slug === current}
        >
          {project.name}
        </DropdownItem>
      ))}
      {projects.length > 0 ? <DropdownDivider /> : null}
      <DropdownItem href={urls.projects()} icon="folder" current={!current}>
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

/** Ancestor trail after the picker; the page itself is named by its heading. */
const Crumbs: FC<{ crumbs: NavCrumb[] }> = ({ crumbs }) => {
  if (crumbs.length === 0) {
    return null;
  }
  return (
    <nav aria-label="Breadcrumb">
      <ol class="crumbs">
        {crumbs.map((crumb) => (
          <li key={crumb.href}>
            <a href={crumb.href}>{crumb.label}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
};

/** Top bar: mobile menu button, project picker, and breadcrumbs. */
export const TopBar: FC<{ nav?: NavConfig }> = ({ nav }) => {
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
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
          <ProjectPicker nav={nav} />
          <Crumbs crumbs={breadcrumbs(nav, urls)} />
        </div>
      </div>
    </header>
  );
};

/** Live region the client script appends toasts to. */
export const ToastRegion: FC = () => {
  return <div class={toastRegion} data-toast-region aria-live="polite" aria-atomic="false" />;
};
