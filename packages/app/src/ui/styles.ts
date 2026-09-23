import { baseCss } from "./styles/base.ts";
import { behaviorCss } from "./styles/behavior.ts";
import { reviewCss } from "./styles/review.ts";
import { tokenCss } from "./styles/tokens.ts";
import type { BrandTheme } from "./theme.ts";

/** Build the global CSS stylesheet from the light and dark brand themes. */
export function baseStyle(light: BrandTheme, dark: BrandTheme): string {
  return [tokenCss(light, dark), baseCss(), reviewCss(), behaviorCss()].join("\n");
}
