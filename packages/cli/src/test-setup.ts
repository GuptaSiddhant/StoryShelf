/**
 * Runs before every test file. The CLI reads the CI provider's own variables to resolve the commit
 * being built (`ci-env.ts`), so a test run on a real CI runner (a GitHub pull request sets
 * `GITHUB_EVENT_NAME`, `GITHUB_EVENT_PATH`, `GITHUB_HEAD_REF`) would otherwise see that run instead of the
 * environment the test builds with `vi.stubEnv`. Remove every provider variable up front; a test
 * that wants one stubs it.
 */
const CI_PROVIDER_VARIABLE =
  /^(?:GITHUB_|GITLAB_CI$|CI_|VERCEL|NETLIFY$|COMMIT_REF$|HEAD$|REVIEW_ID$|PULL_REQUEST$|CIRCLE|BUILDKITE|BITBUCKET_|TF_BUILD$|BUILD_SOURCE|SYSTEM_PULLREQUEST_|JENKINS_URL$|GIT_COMMIT$|GIT_LOCAL_BRANCH$|BRANCH_NAME$|CHANGE_ID$)/u;

for (const name of Object.keys(process.env)) {
  if (CI_PROVIDER_VARIABLE.test(name)) {
    Reflect.deleteProperty(process.env, name);
  }
}
