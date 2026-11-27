import { execFileSync } from "node:child_process";

/** Message and author of one commit, as git records them. */
export interface CommitInfo {
  message?: string;
  authorName?: string;
  authorEmail?: string;
}

/** Fields of `git log` output are separated by NUL, which no field contains. */
const LOG_FORMAT = "--format=%an%x00%ae%x00%B";

/**
 * Message and author of `sha` in the checkout at `cwd`, or null when git is missing, `cwd` is not a
 * repository or the commit is not available locally (a shallow clone, a SHA from another machine).
 * Never throws and never deepens the clone.
 *
 * @param cwd - A directory inside the repository.
 * @param sha - The commit to describe.
 */
export function gitCommitInfo(cwd: string, sha: string): CommitInfo | null {
  let output: string;
  try {
    output = execFileSync("git", ["log", "-1", LOG_FORMAT, `${sha}^{commit}`, "--"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
  } catch {
    return null;
  }
  const [name, email, ...rest] = output.split("\0");
  const message = rest.join("\0").trim();
  return {
    ...(message ? { message } : {}),
    ...(name ? { authorName: name } : {}),
    ...(email ? { authorEmail: email } : {}),
  };
}
