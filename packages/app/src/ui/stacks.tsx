import type { FC } from "hono/jsx";
import { css } from "./css.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

const hGaps = { sm: "0.5rem", md: "0.75rem", lg: "1rem" } as const;
const hAligns = {
  center: "center",
  start: "flex-start",
  end: "flex-end",
  baseline: "baseline",
} as const;
const hJustifies = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
} as const;
const vGaps = hGaps;
const vAligns = {
  stretch: "stretch",
  start: "flex-start",
  center: "center",
  end: "flex-end",
} as const;

type HStackProps = {
  gap?: keyof typeof hGaps;
  align?: keyof typeof hAligns;
  justify?: keyof typeof hJustifies;
  wrap?: boolean;
  children?: unknown;
};

type VStackProps = {
  gap?: keyof typeof vGaps;
  align?: keyof typeof vAligns;
  children?: unknown;
};

function hstackClass(props: Required<Omit<HStackProps, "children">>): Promise<string> {
  const { gap, align, justify, wrap } = props;
  return css`
    /* hstack */
    display: flex;
    gap: ${hGaps[gap]};
    align-items: ${hAligns[align]};
    justify-content: ${hJustifies[justify]};
    flex-wrap: ${wrap ? "wrap" : "nowrap"};
  `;
}

function vstackClass(props: Required<Omit<VStackProps, "children">>): Promise<string> {
  const { gap, align } = props;
  return css`
    /* vstack */
    display: grid;
    gap: ${vGaps[gap]};
    align-items: ${vAligns[align]};
  `;
}

/**
 * Horizontal stack (replaces `row-actions` divs and ad-hoc flex rows).
 * Defaults match the old `row-actions` utility exactly.
 */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const HStack: FC<HStackProps> = ({
  gap = "sm",
  align = "center",
  justify = "start",
  wrap = true,
  children,
}) => {
  return <div class={hstackClass({ gap, align, justify, wrap })}>{children}</div>;
};

/**
 * Vertical stack (replaces `stack` divs and ad-hoc grid rows).
 * Defaults match the old `stack` utility exactly.
 */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const VStack: FC<VStackProps> = ({ gap = "md", align = "stretch", children }) => {
  return <div class={vstackClass({ gap, align })}>{children}</div>;
};
