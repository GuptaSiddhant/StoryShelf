/**
 * The one decision on what a visitor who is not signed in may read (ADR 0011, #1172): the builds
 * list, review page and images of a **public build** (`isPublicBuild`: marked public, or on a
 * branch matching the project's `publicBranchRegex`). The auth gate, `requireProjectVisible`, the
 * media handlers, the builds list and the login page's link all ask this module; nothing else
 * decides an anonymous read.
 *
 * - **Skipped builds stay private.** They point at the build they repeat, which may be private.
 * - **Only reads.** {@link anonymousTarget} matches `GET`/`HEAD` of a fixed set of paths; every
 *   other request of a visitor keeps the sign-in redirect or the 404 it had.
 * - **A private build is a missing build.** In a project with a public build, a private build, a
 *   build of another project and an unknown id all answer `hidden` (one identical 404).
 * - **A project with no public build is unknown.** It answers `sign-in`, exactly as a slug that
 *   does not exist, so a visitor learns nothing about private projects.
 */
import { BuildModel, isPublicBuild, ProjectModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import type { Context } from "hono";
import { getStore } from "../store.ts";
import { findProjectBySlug } from "./helpers.ts";

/** What an anonymous read gets: the page, the standard 404, or the sign-in redirect as before. */
export type AnonymousRead = "read" | "hidden" | "sign-in";

/** The project (and build) a visitor's request names. */
export interface AnonymousTarget {
  slug: string;
  buildId?: string;
}

/** `Cache-Control` of every anonymous answer: only the visitor's browser keeps it, revalidated. */
export const ANONYMOUS_CACHE_CONTROL = "private, no-cache";

/** The paths a visitor may ask for: the project, its builds list, a build, its review and images. */
const READ_PATHS: readonly RegExp[] = [
  /^\/projects\/(?<slug>[^/]+)\/?$/u,
  /^\/projects\/(?<slug>[^/]+)\/builds\/?$/u,
  /^\/projects\/(?<slug>[^/]+)\/builds\/(?<buildId>[^/]+)(?:\/diff)?\/?$/u,
  /^\/api\/v1\/projects\/(?<slug>[^/]+)\/builds\/(?<buildId>[^/]+)\/snapshots\/[^/]+\/(?:image|diff|baseline)$/u,
];

/** The target of a request a visitor may make, or null for every other request. */
export function anonymousTarget(method: string, path: string): AnonymousTarget | null {
  if (method !== "GET" && method !== "HEAD") {
    return null;
  }
  for (const pattern of READ_PATHS) {
    const groups = pattern.exec(path)?.groups;
    const slug = groups?.["slug"];
    if (slug && slug !== "new") {
      const buildId = groups["buildId"];
      return buildId === undefined ? { slug } : { slug, buildId };
    }
  }
  return null;
}

/**
 * Whether the request comes from a visitor: sign-in is on, nobody is signed in and no token is
 * sent (a bearer token is decided by the API's own rules, never as a visitor).
 */
export function isAnonymousVisitor(c?: Pick<Context, "req">): boolean {
  const { authEnabled, user } = getStore();
  return authEnabled && user === null && !c?.req.header("authorization");
}

type ReadableFields = Pick<Build, "public" | "gitBranch" | "status">;

/**
 * Whether a visitor may read `build`: it is public (ADR 0011) and not skipped. A skipped build has
 * no capture of its own and points at the build it repeats, which may be private, so a visitor
 * never sees one.
 */
export function isVisitorReadable(
  project: Pick<Project, "publicBranchRegex">,
  build: ReadableFields,
): boolean {
  return build.status !== "skipped" && isPublicBuild(project, build);
}

/** The builds of `project` a visitor may read, in the order given. */
export function publicBuildsOf<T extends ReadableFields>(
  project: Pick<Project, "publicBranchRegex">,
  builds: readonly T[],
): T[] {
  return builds.filter((build) => isVisitorReadable(project, build));
}

async function hasPublicBuild(project: Project): Promise<boolean> {
  const builds = await new BuildModel(getStore().db).list(project.id);
  return builds.some((build) => isVisitorReadable(project, build));
}

async function decide(target: AnonymousTarget): Promise<AnonymousRead> {
  const project = await findProjectBySlug(target.slug);
  if (!project) {
    return "sign-in";
  }
  if (target.buildId !== undefined) {
    const build = await new BuildModel(getStore().db).get(target.buildId);
    if (build?.projectId === project.id && isVisitorReadable(project, build)) {
      return "read";
    }
  }
  if (!(await hasPublicBuild(project))) {
    return "sign-in";
  }
  return target.buildId === undefined ? "read" : "hidden";
}

/** Decisions already made for a request (the gate and `requireProjectVisible` both ask). */
const decided = new WeakMap<Request, Promise<AnonymousRead>>();

/**
 * The decision for a visitor's request: `read` only for a request {@link anonymousTarget} matches,
 * from a visitor ({@link isAnonymousVisitor}), on a public build (or a project that has one).
 * Anything else that names a project with a public build is `hidden`; the rest is `sign-in`.
 */
export async function anonymousRead(c: Pick<Context, "req">): Promise<AnonymousRead> {
  const target = anonymousTarget(c.req.method, c.req.path);
  if (!target || !isAnonymousVisitor(c)) {
    return "sign-in";
  }
  const known = decided.get(c.req.raw);
  if (known) {
    return await known;
  }
  const decision = decide(target);
  decided.set(c.req.raw, decision);
  return await decision;
}

/**
 * The first project, by name, whose builds a visitor may browse: the login page links to it.
 * Null when no project has a public build.
 */
export async function firstBrowsableProject(): Promise<Project | null> {
  const projects = await new ProjectModel(getStore().db).list();
  for (const project of projects.toSorted((a, b) => a.name.localeCompare(b.name))) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- stops at the first project that has one
    if (await hasPublicBuild(project)) {
      return project;
    }
  }
  return null;
}
