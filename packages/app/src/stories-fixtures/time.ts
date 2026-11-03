/** The fixed "now" of every story: relative times and dates never change (see `.storybook/render.tsx`). */
export const STORY_NOW = "2026-01-15T12:00:00.000Z";

/** An ISO timestamp this many hours before `STORY_NOW`. */
export function hoursAgo(hours: number): string {
  return new Date(Date.parse(STORY_NOW) - hours * 3_600_000).toISOString();
}
