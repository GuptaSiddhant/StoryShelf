// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone, pageStory } from "../../.storybook/page.tsx";
import type { UsageReport } from "../insights/usage-report.ts";
import { renderAdminAiPage } from "./admin-ai.tsx";

const meta: Meta = { title: "Pages/Admin/AI usage" };
export default meta;

const usage: UsageReport = {
  days: [
    { day: "2026-01-15", tokens: 18_450, calls: 41, failed: 1 },
    { day: "2026-01-14", tokens: 52_300, calls: 118, failed: 0 },
    { day: "2026-01-13", tokens: 9_870, calls: 22, failed: 3 },
  ],
  profiles: [
    { profile: "insight", tokens: 61_200, calls: 139 },
    { profile: "design-summary", tokens: 19_420, calls: 42 },
  ],
  todayTokens: 18_450,
  dailyTokens: 100_000,
};

/** Usage against a daily budget: today's position over the cap, the days, and the profiles. */
export const WithBudget = pageStory(() => renderAdminAiPage(usage));

/** No daily cap configured: today's tokens alone. */
export const NoBudget = pageStory(() => renderAdminAiPage({ ...usage, dailyTokens: null }));

/** Nothing counted yet: the empty state in place of the tables. */
export const NoUsageYet = pageStory(() =>
  renderAdminAiPage({ days: [], profiles: [], todayTokens: 0, dailyTokens: 100_000 }),
);

/** The two tables on a 375px phone: each scrolls in its own region and the page does not scroll sideways. */
export const OnAPhone = onAPhone(pageStory(() => renderAdminAiPage(usage)));
