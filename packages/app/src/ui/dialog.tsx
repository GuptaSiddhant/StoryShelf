import type { FC } from "hono/jsx";
import { Button, type ButtonSize, type ButtonVariant } from "./buttons.tsx";
import { css } from "./css.ts";
import { Icon } from "./icons/icon.tsx";
import type { IconName } from "./icons/paths.ts";

const dialogRoot = css`
  /* dialog */
  width: min(32rem, calc(100vw - 2rem));
  max-height: calc(100vh - 2rem);
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-card);
  color: var(--text-primary);
  box-shadow: var(--shadow);
  &::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
`;

const dialogHeader = css`
  /* dialog-header */
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
`;

const dialogTitle = css`
  /* dialog-title */
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
`;

const dialogClose = css`
  /* dialog-close */
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: var(--control-sm);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  &:hover {
    background: var(--surface-muted);
    color: var(--text-primary);
  }
`;

const dialogBody = css`
  /* dialog-body */
  padding: var(--space-4);
`;

const dialogFooter = css`
  /* dialog-footer */
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border);
`;

/**
 * A native `<dialog>` the shell script opens with `showModal()` once its body is swapped in
 * (focus is trapped, Escape closes it, focus returns to the opener). Open it with `DialogLink`;
 * the server answers an HTMX request with the form fragment and a plain one with the full page.
 * Buttons in `footer` belong to the form in the body through their `form` attribute.
 */
export const Dialog: FC<{
  id: string;
  title: string;
  /** Accessible name of the close button. */
  closeLabel?: string;
  footer?: unknown;
  /** Render it showing (non-modal): for a form page or a story that shows the open state. */
  open?: boolean;
  children?: unknown;
}> = ({ id, title, closeLabel = "Close", footer, open, children }) => {
  return (
    <dialog id={id} class={dialogRoot} aria-labelledby={`${id}-title`} data-dialog open={open}>
      <div class={dialogHeader}>
        <h2 id={`${id}-title`} class={dialogTitle}>
          {title}
        </h2>
        <button type="button" class={dialogClose} aria-label={closeLabel} data-dialog-close>
          <Icon name="x" />
        </button>
      </div>
      <div id={`${id}-body`} class={dialogBody}>
        {children}
      </div>
      {footer ? <div class={dialogFooter}>{footer}</div> : null}
    </dialog>
  );
};

/**
 * The opener: a real link to the form's page (works without JavaScript and from a pasted URL)
 * that HTMX fetches into the dialog body instead.
 */
export const DialogLink: FC<{
  dialogId: string;
  href: string;
  /** Style the opener as a button. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  children?: unknown;
  [key: string]: unknown;
}> = ({ dialogId, href, variant, size, icon, children, ...rest }) => {
  if (variant) {
    return (
      <Button
        variant={variant}
        size={size ?? "md"}
        icon={icon}
        href={href}
        hx-get={href}
        hx-target={`#${dialogId}-body`}
        hx-swap="innerHTML"
        hx-push-url="false"
        data-dialog-open={dialogId}
        {...rest}
      >
        {children}
      </Button>
    );
  }
  return (
    <a
      href={href}
      hx-get={href}
      hx-target={`#${dialogId}-body`}
      hx-swap="innerHTML"
      hx-push-url="false"
      data-dialog-open={dialogId}
      {...rest}
    >
      {children}
    </a>
  );
};
