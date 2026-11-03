import type { CatalogEntry } from "@storyshelf/core/capture";
import type {
  Baseline,
  Build,
  BuildComponent,
  Comment,
  Project,
  Snapshot,
} from "@storyshelf/core/schema";
import { hoursAgo } from "./time.ts";

/**
 * Fixed, realistic data for the page stories: one project ("Design system") with a published
 * default-branch build, a feature branch under review, and builds that failed, are capturing or were
 * rejected. Ids are fixed ULID-shaped strings; nothing is random and nothing reads the clock.
 * Typed with the real row types so a schema change breaks the stories at compile time.
 */
const id = (suffix: string): string => `01JD000000000000000000${suffix}`;

export const PROJECT_ID = id("PRJ001");
export const OTHER_PROJECT_ID = id("PRJ002");
export const BUILD_MAIN = id("BLD001");
export const BUILD_REVIEW = id("BLD002");
export const BUILD_FAILED = id("BLD003");
export const BUILD_CAPTURING = id("BLD004");
export const BUILD_REJECTED = id("BLD005");

export const project: Project = {
  id: PROJECT_ID,
  name: "Design system",
  slug: "design-system",
  gitRepository: "acme/design-system",
  gitDefaultBranch: "main",
  pixelThreshold: 0.1,
  maxDiffRatio: 0.001,
  publicBranchRegex: null,
  storybookMeta: null,
  executePlay: true,
  playTimeoutMs: 10_000,
  runA11y: true,
  runTests: false,
  reviewEnabled: true,
  reviewApprovals: 1,
  createdAt: hoursAgo(24 * 60),
  updatedAt: hoursAgo(24 * 60),
};

export const otherProject: Project = {
  ...project,
  id: OTHER_PROJECT_ID,
  name: "Web app",
  slug: "web-app",
  gitRepository: "acme/web-app",
};

const build = (overrides: Partial<Build> & Pick<Build, "id" | "gitSha" | "gitBranch">): Build => ({
  projectId: PROJECT_ID,
  isDefault: overrides.gitBranch === "main",
  authorEmail: "ada@example.com",
  authorName: "Ada Lovelace",
  message: null,
  public: false,
  status: "approved",
  snapshotCount: 0,
  changedCount: 0,
  approvedCount: 0,
  rejectedCount: 0,
  inheritedCount: 0,
  affectedOnly: false,
  baselineSha: null,
  changedFiles: null,
  affectedImportPaths: null,
  testResults: null,
  createdAt: hoursAgo(48),
  updatedAt: hoursAgo(48),
  ...overrides,
});

export const builds: Build[] = [
  build({
    id: BUILD_CAPTURING,
    gitSha: "5c4d3e2",
    gitBranch: "feature/dark-tabs",
    status: "capturing",
    authorName: "Grace Hopper",
    authorEmail: "grace@example.com",
    message: "feat(tabs): dark mode tab bar",
    snapshotCount: 11,
    createdAt: hoursAgo(0.1),
    updatedAt: hoursAgo(0.05),
  }),
  build({
    id: BUILD_REVIEW,
    gitSha: "9f8e7d6",
    gitBranch: "feature/button-radius",
    status: "reviewing",
    message: "feat(button): rounder corners",
    snapshotCount: 11,
    changedCount: 3,
    approvedCount: 0,
    inheritedCount: 4,
    baselineSha: "a1b2c3d",
    createdAt: hoursAgo(5),
    updatedAt: hoursAgo(4.5),
  }),
  build({
    id: BUILD_FAILED,
    gitSha: "7a6b5c4",
    gitBranch: "fix/modal-focus",
    status: "failed",
    authorName: "Alan Turing",
    authorEmail: "alan@example.com",
    message: "fix(modal): trap focus",
    createdAt: hoursAgo(20),
    updatedAt: hoursAgo(19.8),
  }),
  build({
    id: BUILD_MAIN,
    gitSha: "a1b2c3d",
    gitBranch: "main",
    status: "approved",
    message: "chore: bump dependencies",
    snapshotCount: 11,
    approvedCount: 11,
    createdAt: hoursAgo(48),
    updatedAt: hoursAgo(47),
  }),
  build({
    id: BUILD_REJECTED,
    gitSha: "3b2a1c0",
    gitBranch: "feature/card-shadow",
    status: "rejected",
    authorName: "Grace Hopper",
    authorEmail: "grace@example.com",
    message: "feat(card): heavier shadow",
    snapshotCount: 11,
    changedCount: 2,
    rejectedCount: 2,
    createdAt: hoursAgo(96),
    updatedAt: hoursAgo(94),
  }),
];

const entry = (component: string, name: string, tags: string[] = ["autodocs"]): CatalogEntry => ({
  id: `kit-${component.toLowerCase()}--${name.toLowerCase().replaceAll(" ", "-")}`,
  title: `Kit/${component}`,
  name,
  importPath: `./src/${component}.stories.tsx`,
  type: "story",
  tags,
});

/** The Storybook catalog every build of the project publishes: six components, eleven stories. */
export const catalogEntries: CatalogEntry[] = [
  entry("Button", "Primary"),
  entry("Button", "Secondary"),
  entry("Button", "Danger"),
  entry("Card", "Default"),
  entry("Card", "Elevated"),
  entry("Badge", "Tones"),
  entry("Modal", "Open"),
  entry("Modal", "Confirm"),
  entry("Input", "Default"),
  entry("Input", "With error"),
  entry("Tabs", "Default"),
];

const NO_REVIEW = { reviewedBy: null, reviewedAt: null };

function snapshotsOf(
  buildId: string,
  statuses: Record<string, Snapshot["status"]>,
  ratios: Record<string, number> = {},
): Snapshot[] {
  return catalogEntries.map((story) => {
    const status = statuses[story.id] ?? "unchanged";
    const ratio = ratios[story.id] ?? 0;
    return {
      id: `${buildId.slice(-6)}-${story.id}`,
      projectId: PROJECT_ID,
      buildId,
      storyId: story.id,
      storyName: story.name,
      storyTitle: story.title,
      storyImportPath: story.importPath,
      designUrl: null,
      viewportName: "desktop",
      viewportWidth: 1280,
      viewportHeight: 800,
      screenshotPath: `${PROJECT_ID}/${buildId}/${story.id}.png`,
      diffPath: ratio > 0 ? `${PROJECT_ID}/${buildId}/${story.id}.diff.png` : null,
      diffPixels: Math.round(ratio * 1_024_000),
      diffRatio: ratio,
      diffPassed: ratio === 0,
      status,
      ...NO_REVIEW,
      infraHash: null,
      envChange: null,
      inherited: false,
      baselineId: status === "new" ? null : `base-${story.id}`,
      baselineVersion: hoursAgo(47),
      browser: "chromium",
      durationMs: 420,
      a11yViolations: null,
      createdAt: hoursAgo(5),
      updatedAt: hoursAgo(4.5),
    };
  });
}

export const snapshots: Snapshot[] = [
  ...snapshotsOf(
    BUILD_MAIN,
    Object.fromEntries(catalogEntries.map((story) => [story.id, "approved" as const])),
  ),
  ...snapshotsOf(
    BUILD_REVIEW,
    {
      "kit-button--primary": "changed",
      "kit-button--secondary": "changed",
      "kit-card--elevated": "new",
      "kit-tabs--default": "changed",
    },
    { "kit-button--primary": 0.024, "kit-button--secondary": 0.019, "kit-tabs--default": 0.006 },
  ),
];

export const baselines: Baseline[] = catalogEntries.map((story) => ({
  id: `base-${story.id}`,
  projectId: PROJECT_ID,
  storyId: story.id,
  viewportName: "desktop",
  branch: "main",
  snapshotId: `${BUILD_MAIN.slice(-6)}-${story.id}`,
  sourceBuildId: BUILD_MAIN,
  screenshotPath: `${PROJECT_ID}/${BUILD_MAIN}/${story.id}.png`,
  infraHash: null,
  fingerprint: null,
  browser: "chromium",
  createdAt: hoursAgo(47),
  updatedAt: hoursAgo(47),
}));

export const comments: Comment[] = [
  {
    id: id("CMT001"),
    projectId: PROJECT_ID,
    buildId: BUILD_REVIEW,
    snapshotId: null,
    storyId: null,
    userId: "grace@example.com",
    body: "The radius change looks intentional. Please confirm with design before approving.",
    parentId: null,
    resolved: false,
    createdAt: hoursAgo(4),
    updatedAt: hoursAgo(4),
  },
  {
    id: id("CMT002"),
    projectId: PROJECT_ID,
    buildId: BUILD_REVIEW,
    snapshotId: `${BUILD_REVIEW.slice(-6)}-kit-button--primary`,
    storyId: "kit-button--primary",
    userId: "alan@example.com",
    body: "Corners now match the Figma frame.",
    parentId: null,
    resolved: true,
    createdAt: hoursAgo(3),
    updatedAt: hoursAgo(2),
  },
];

/** The component rows each published build was catalogued into (one per story file). */
export const buildComponents: BuildComponent[] = [BUILD_MAIN, BUILD_REVIEW].flatMap((buildId) =>
  [...new Set(catalogEntries.map((story) => story.importPath))].map((importPath) => {
    const stories = catalogEntries.filter((story) => story.importPath === importPath);
    return {
      id: `${buildId.slice(-6)}-${importPath}`,
      projectId: PROJECT_ID,
      buildId,
      // The catalogue stores the normalized path: no leading "./".
      importPath: importPath.replace(/^\.\//u, ""),
      title: stories[0]?.title ?? importPath,
      storyCount: stories.length,
      hash: `${buildId.slice(-6)}-${stories.length}-${importPath.length}`.padEnd(64, "0"),
      createdAt: hoursAgo(5),
    };
  }),
);
