/**
 * The brand mark for a maskable app icon (ADR 0048): a full-bleed square in the mark's purple with
 * the glyph of `markSource` (`./mark.ts`) scaled into the central safe zone, so any launcher mask
 * (circle, squircle) keeps it whole. Keep the glyph in step with `markSource`.
 */
export const maskableMarkSource = String.raw`<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512' viewBox='0 0 64 64' role='img' aria-label='StoryShelf'><clipPath id='safe-mark'><rect width='64' height='64'/></clipPath><rect width='64' height='64' fill='#5b3fd6'/><g transform='translate(9.6 9.6) scale(0.7)'><g clip-path='url(#safe-mark)'><path d='M64 13.5 H22.5 a8 8 0 0 0 -8 8 V32 H49.5 V42.5 a8 8 0 0 1 -8 8 H0' fill='none' stroke='#ffffff' stroke-width='5'/><rect x='20.75' y='19.75' width='7.75' height='10.5' rx='1.75' fill='none' stroke='#ffffff' stroke-width='1.5'/><rect x='32.25' y='19' width='9.25' height='12' rx='2.5' fill='#ffffff'/><rect x='20.75' y='38.25' width='7.75' height='10.5' rx='1.75' fill='none' stroke='#ffffff' stroke-width='1.5'/><rect x='33' y='38.25' width='7.75' height='10.5' rx='1.75' fill='none' stroke='#ffffff' stroke-width='1.5'/></g></g></svg>`;
