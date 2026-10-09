/** A link from a downstream project to the upstream project that publishes a package it consumes. */
export interface ProjectLink {
  id: string;
  /** Project that consumes the package (the app). */
  downstreamId: string;
  /** Project whose Storybook publishes the package's components (the design system). */
  upstreamId: string;
  packageName: string;
  createdAt: string;
}

/** A dependency package a story file reaches in a build. */
export interface BuildPackageUsage {
  id: string;
  projectId: string;
  buildId: string;
  /** Story import path, joined to `snapshots.storyImportPath` at read time. */
  storyImportPath: string;
  packageName: string;
  /** First module inside the package the story reaches. */
  modulePath: string;
  /** Installed package version at upload time; null when it could not be resolved. */
  version: string | null;
  createdAt: string;
}
