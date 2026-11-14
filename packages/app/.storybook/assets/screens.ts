/**
 * Fixed screenshots for stories: a small mock UI at 640x400 in four versions (baseline, current,
 * diff overlay, design render). Inline SVG data URIs, so they are byte-identical on every build and
 * need no network and no files to serve.
 */
const WIDTH = 640;
const HEIGHT = 400;

function uri(body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${body}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function screen(options: { button: string; radius: number; title: string }): string {
  return `
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>
    <rect width="${WIDTH}" height="56" fill="#f4f4f5"/>
    <rect x="24" y="18" width="96" height="20" rx="4" fill="#09090b"/>
    <text x="24" y="120" font-family="sans-serif" font-size="28" font-weight="700" fill="#09090b">${options.title}</text>
    <rect x="24" y="140" width="420" height="12" rx="4" fill="#d4d4d8"/>
    <rect x="24" y="164" width="340" height="12" rx="4" fill="#e4e4e7"/>
    <rect x="24" y="212" width="132" height="44" rx="${options.radius}" fill="${options.button}"/>
    <rect x="172" y="212" width="132" height="44" rx="${options.radius}" fill="#ffffff" stroke="#d4d4d8"/>
    <rect x="24" y="288" width="592" height="80" rx="8" fill="#fafafa" stroke="#e4e4e7"/>`;
}

export const baselineShot = uri(screen({ button: "#1d5fcf", radius: 8, title: "Welcome back" }));
export const currentShot = uri(screen({ button: "#1d5fcf", radius: 22, title: "Welcome back" }));
export const designShot = uri(screen({ button: "#1d5fcf", radius: 8, title: "Welcome back" }));

/** The change between baseline and current: the two buttons' corners, highlighted on a faded page. */
export const diffShot = uri(`
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff" opacity="0.35"/>
  <rect x="24" y="212" width="132" height="44" rx="22" fill="#e11d74" opacity="0.8"/>
  <rect x="172" y="212" width="132" height="44" rx="22" fill="#e11d74" opacity="0.8"/>`);

/**
 * A plain card at an exact pixel size, for the one-scale stories: a 100×100 baseline beside a
 * 120×100 current must keep the 100:120 ratio on the stage and never be drawn wider than itself.
 */
export function sizedShot(width: number, height: number, fill: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff"/><rect x="10" y="10" width="${width - 20}" height="${height - 20}" rx="8" fill="${fill}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** 100×100: the baseline of the size-change stories. */
export const squareShot = sizedShot(100, 100, "#1d5fcf");
/** 120×100: the same card, 20 px wider. */
export const wideShot = sizedShot(120, 100, "#1d5fcf");
