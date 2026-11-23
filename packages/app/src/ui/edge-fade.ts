import { css } from "./css.ts";

/**
 * Fades the edge of a horizontal scroller that still has content beyond it, so a row cut by the
 * viewport reads as scrollable. Driven by the scroller's own scroll position (`--edge-fade-start|end`
 * are registered in the global stylesheet, `behavior.ts`); a browser without scroll-driven animation
 * shows the plain scroller. Compose it into a family's own template with `${edgeFade}`.
 */
export const edgeFade = css`
  /* edge-fade */
  @supports (animation-timeline: scroll()) {
    & {
      mask-image: linear-gradient(
        to right,
        transparent,
        black var(--edge-fade-start),
        black calc(100% - var(--edge-fade-end)),
        transparent
      );
      animation: ss-edge-fade linear both;
      animation-timeline: scroll(self inline);
    }
  }
`;
