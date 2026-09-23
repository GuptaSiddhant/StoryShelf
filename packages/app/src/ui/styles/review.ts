/** Review surfaces: snapshot nav, diff panes with view modes, comments. */
export function reviewCss(): string {
  return `${snapshotNavCss()}\n${diffGridCss()}\n${reviewBarCss()}\n${commentCss()}`;
}

function snapshotNavCss(): string {
  return `
    .review-layout { display: flex; gap: 1rem; align-items: flex-start; }
    .review-nav { flex: 0 0 300px; max-width: 34%; min-width: 250px; }
    .review-nav__head { padding: .6rem .75rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
    .review-nav__list { max-height: 70vh; overflow: auto; }
    .snapshot-nav { display: flex; flex-direction: column; gap: .2rem; padding: .6rem .75rem; border-bottom: 1px solid var(--border-subtle); text-decoration: none; color: inherit; }
    .snapshot-nav:hover { background: var(--surface-subtle); text-decoration: none; }
    .snapshot-nav--active { background: var(--surface-muted); border-left: 3px solid var(--accent); padding-left: calc(.75rem - 3px); }
    .snapshot-nav__title { display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; font-weight: 600; font-size: .875rem; }
    .snapshot-nav__meta { font-size: .78rem; color: var(--text-secondary); }
    .review-main { flex: 1; min-width: 0; display: grid; gap: 1rem; align-content: start; }
    @media (max-width: 1024px) {
      .review-layout { flex-direction: column; }
      .review-nav { flex: auto; max-width: none; min-width: 0; width: 100%; }
      .review-nav__list { max-height: 240px; }
    }`;
}

function diffGridCss(): string {
  return `
    .diff-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; }
    .diff-grid[data-view="baseline"] [data-pane]:not([data-pane="baseline"]) { display: none; }
    .diff-grid[data-view="current"] [data-pane]:not([data-pane="current"]) { display: none; }
    .diff-grid[data-view="diff"] [data-pane]:not([data-pane="diff"]) { display: none; }
    .diff-grid[data-view="baseline"], .diff-grid[data-view="current"], .diff-grid[data-view="diff"] { grid-template-columns: minmax(0, 1fr); }
    .diff-grid[data-view="baseline"] .diff-pane__img, .diff-grid[data-view="current"] .diff-pane__img, .diff-grid[data-view="diff"] .diff-pane__img { max-height: 70vh; object-fit: contain; background: var(--surface-subtle); }
    @media (max-width: 900px) { .diff-grid[data-view="split"] { grid-template-columns: 1fr; } }
    .diff-pane { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--surface-card); }
    .diff-pane__label { padding: .4rem .6rem; font-weight: 600; font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--text-secondary); background: var(--surface-subtle); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
    .diff-pane__img { display: block; width: 100%; height: auto; background: repeating-conic-gradient(#e5e7eb 0% 25%, #f9fafb 0% 50%) 0 0 / 16px 16px; }
    [data-theme="dark"] .diff-pane__img { background: repeating-conic-gradient(#27272a 0% 25%, #18181b 0% 50%) 0 0 / 16px 16px; }
    .diff-placeholder { aspect-ratio: 16/9; display: grid; place-items: center; gap: .25rem; background: var(--surface-subtle); color: var(--text-secondary); font-size: .85rem; text-align: center; padding: 1rem; }
    .snapshot-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
    .snapshot-card { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--surface-card); display: flex; flex-direction: column; }
    .snapshot-card__head { padding: .6rem .75rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; gap: .5rem; align-items: center; }
    .snapshot-card__meta { font-size: .78rem; color: var(--text-secondary); }
    .snapshot-card__body { padding: .5rem; display: grid; gap: .5rem; }`;
}

function reviewBarCss(): string {
  return `
    .review-bar { position: sticky; top: 52px; z-index: 10; display: flex; justify-content: space-between; gap: .75rem; align-items: center; flex-wrap: wrap; padding: .625rem .75rem; margin: -.25rem -.25rem .75rem; background: color-mix(in srgb, var(--surface-card) 92%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); border-radius: var(--radius-sm); }
    .review-bar__title { margin: 0; font-size: 1rem; font-weight: 650; letter-spacing: -.01em; }
    .review-bar__meta { margin: .15rem 0 0; color: var(--text-secondary); font-size: .82rem; display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; }
    .segmented { display: inline-flex; padding: 2px; gap: 1px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-muted); }
    .segmented button { appearance: none; border: 1px solid transparent; background: transparent; color: var(--text-secondary); font: inherit; font-size: .8rem; font-weight: 600; border-radius: calc(var(--radius-sm) - 2px); padding: .35rem .6rem; cursor: pointer; min-height: 32px; }
    .segmented button[aria-pressed="true"] { background: var(--surface-card); color: var(--text-primary); border-color: var(--border); box-shadow: var(--shadow); }`;
}

function commentCss(): string {
  return `
    .comment { border: 1px solid var(--border); border-radius: var(--radius); padding: .75rem; background: var(--surface-card); }
    .comment__head { display: flex; gap: .5rem; align-items: center; font-size: .82rem; color: var(--text-secondary); flex-wrap: wrap; }
    .comment__body { margin: .5rem 0 0; white-space: pre-wrap; word-break: break-word; font-size: .875rem; }
    .comment__actions { margin-top: .5rem; }`;
}
