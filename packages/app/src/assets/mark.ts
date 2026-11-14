/**
 * The StoryShelf mark on its accent tile: the default sidebar logo (`ui.logo` overrides it).
 * Hand-written; the sources and rules are in `apps/website/src/assets/brand/` and `docs/brand.md`.
 */
export const markSource = String.raw`<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64' role='img' aria-label='StoryShelf'><rect width='64' height='64' rx='14' fill='#5b3fd6'/><g transform='translate(10 7.25) scale(2.75)'><rect x='2' y='6' width='3' height='7' rx='0.4' fill='#ffffff'/><rect x='6' y='3' width='3' height='10' rx='0.4' fill='#ffffff'/><rect x='11.63' y='4' width='2.5' height='9' rx='0.4' transform='rotate(-17 11.63 13)' fill='#cbc2ff'/><rect x='1' y='13' width='14' height='2' rx='0.4' fill='#ffffff'/></g></svg>`;

/**
 * The favicon: the bare mark (no tile, legible at 16 px), following the browser's colour
 * scheme. Not brandable, so a StoryShelf tab stays recognisable.
 */
export const faviconSource = String.raw`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' role='img' aria-label='StoryShelf'><style>.ink{fill:#09090b}.lean{fill:#5b3fd6}@media (prefers-color-scheme:dark){.ink{fill:#fafafa}.lean{fill:#9d8cff}}</style><rect class='ink' x='2' y='6' width='3' height='7' rx='0.4'/><rect class='ink' x='6' y='3' width='3' height='10' rx='0.4'/><rect class='lean' x='11.63' y='4' width='2.5' height='9' rx='0.4' transform='rotate(-17 11.63 13)'/><rect class='ink' x='1' y='13' width='14' height='2' rx='0.4'/></svg>`;
