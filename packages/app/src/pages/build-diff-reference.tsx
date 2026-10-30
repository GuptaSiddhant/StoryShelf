import type { HtmlEscapedString } from "hono/utils/html";
import type { BaselineReference } from "../routers/baseline-reference.ts";
import { Alert } from "../ui/components.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HTML or a promise */
export function BaselineReferenceNotice(props: {
  reference: BaselineReference;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const reference = props.reference;
  if (reference.kind === "none")
    return (
      <Alert tone="info" title="No baseline at capture">
        This was a new comparison; no baseline existed when it was captured.
      </Alert>
    );
  if (reference.kind === "unavailable")
    return (
      <Alert tone="warning" title="Baseline reference unavailable">
        The original baseline details or image are unavailable or have changed since this diff was
        computed. For older records, any image shown may be the current baseline rather than the one
        used for the diff.
      </Alert>
    );
  return (
    <Alert tone="info" title="Comparison baseline">
      {reference.defaultBranch ? "Default branch" : "Accepted branch"}: {reference.branch}. Baseline
      updated {reference.updatedAt}.
      {reference.imageAvailable ? "" : " The baseline image is unavailable."}
      {reference.build
        ? ` Reference build ${reference.build.id}, commit ${reference.build.gitSha.slice(0, 7)}.`
        : " Reference build and commit are unavailable."}
    </Alert>
  );
}
