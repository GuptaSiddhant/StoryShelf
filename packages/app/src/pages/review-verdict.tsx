/** The verdict card of the build page: where the build stands, the verdicts, and the reviewer's controls. */
import { BUILD_STATUSES } from "@storyshelf/core/types";
import type { HtmlEscapedString } from "hono/utils/html";
import type { ReviewSectionData } from "../routers/review-section.handlers.ts";
import { csrfField } from "../shell/csrf-field.tsx";
import {
  Avatar,
  Badge,
  Button,
  Card,
  HStack,
  Meta,
  RelativeTime,
  SectionTitle,
  TextareaField,
  VStack,
  statusTone,
} from "../ui/components.tsx";
import { openChangeRequests, openRequestsLabel } from "./review-change-requests.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** Build-level verdicts: the approvals so far, each reviewer's latest verdict, and the controls. */
export function VerdictCard(props: { data: ReviewSectionData }): Rendered {
  const { data } = props;
  const open = openChangeRequests(data).length;
  return (
    <Card>
      <HStack justify="between">
        <SectionTitle>Review</SectionTitle>
        <HStack>
          {open > 0 ? <Badge tone="warning">{openRequestsLabel(open)}</Badge> : null}
          <Badge tone={statusTone(data.state.status)}>{standing(data)}</Badge>
        </HStack>
      </HStack>
      <Meta>{summary(data)}</Meta>
      <AssignedReviewers data={data} />
      <VStack>
        {data.state.latest.map((review): Rendered => (
          <HStack key={review.id} align="baseline" wrap={false}>
            <Badge tone={review.verdict === "approved" ? "success" : "danger"}>
              {review.verdict}
            </Badge>
            <strong>
              {review.userId ? (data.names.get(review.userId) ?? review.userId) : "anonymous"}
            </strong>
            <Meta as="span">
              <RelativeTime value={review.createdAt} />
            </Meta>
            {review.body ? <span>{review.body}</span> : null}
          </HStack>
        ))}
      </VStack>
      <VerdictControls data={data} />
    </Card>
  );
}

/**
 * The members the component owners assigned to this build, each with where they stand. Display
 * only: any approver may still approve, and the counts and rules do not read this. Nothing renders
 * when no owner matched, since the default behaviour needs no explanation.
 */
function AssignedReviewers(props: { data: ReviewSectionData }): Rendered | null {
  const { data } = props;
  if (data.assigned.length === 0) {
    return null;
  }
  return (
    <VStack gap="md">
      <SectionTitle level={3}>Assigned reviewers</SectionTitle>
      <VStack>
        {data.assigned.map((reviewer): Rendered => {
          const verdict = data.state.latest.find((review) => review.userId === reviewer.userId);
          const name = data.names.get(reviewer.userId) ?? reviewer.userId;
          return (
            <HStack key={reviewer.userId}>
              <Avatar name={name} size="sm" />
              <strong>{name}</strong>
              <Badge tone={verdictTone(verdict?.verdict)}>{verdictWord(verdict?.verdict)}</Badge>
              <Meta as="span">{reviewer.components.join(", ")}</Meta>
            </HStack>
          );
        })}
      </VStack>
      <Meta>Assigned from component owners. Anyone who can approve may still approve.</Meta>
      {data.state.latest.length > 0 ? <SectionTitle level={3}>Verdicts</SectionTitle> : null}
    </VStack>
  );
}

/** The word for an assigned reviewer's standing (never colour alone). */
function verdictWord(verdict: string | undefined): string {
  if (verdict === "approved") return "Approved";
  return verdict === "rejected" ? "Rejected" : "Waiting";
}

/** The badge tone of an assigned reviewer's standing. */
function verdictTone(verdict: string | undefined): "success" | "danger" | "neutral" {
  if (verdict === "approved") return "success";
  return verdict === "rejected" ? "danger" : "neutral";
}

/**
 * The form for a reviewer once the build can take a verdict; while its Storybook is still
 * publishing a notice stands in (the server refuses a verdict until then, ADR 0013, decision 3).
 */
function VerdictControls(props: { data: ReviewSectionData }): Rendered | null {
  const { data } = props;
  if (!data.canVerdict || data.build.status === "failed") {
    return null;
  }
  if (data.publishing === "pending") {
    return (
      <VStack>
        <Meta>Waiting for the Storybook to publish. You can give a verdict once it has.</Meta>
        <VerdictForm data={data} disabled />
      </VStack>
    );
  }
  return data.publishing === "success" ? <VerdictForm data={data} /> : null;
}

/** The reviewer's controls: an optional note and the two verdicts; `disabled` while the build cannot take one yet. */
function VerdictForm(props: { data: ReviewSectionData; disabled?: boolean }): Rendered {
  const { project, build } = props.data;
  const { disabled } = props;
  const url = `/projects/${project.slug}/builds/${build.id}/reviews`;
  const open = openChangeRequests(props.data).length;
  return (
    <form method="post" action={url} hx-post={url} hx-target="body" class="mt-1 max-w-prose">
      {csrfField()}
      <VStack>
        <TextareaField
          label="Note with your verdict (optional)"
          name="body"
          id="verdict-body"
          rows={2}
        />
        <HStack>
          <Button
            variant="primary"
            type="submit"
            name="verdict"
            value="approved"
            disabled={disabled}
            {...(open > 0 ? approveAnyway(url, open) : {})}
          >
            Approve build
          </Button>
          <Button
            variant="danger"
            type="submit"
            name="verdict"
            value="rejected"
            disabled={disabled}
          >
            Reject build
          </Button>
        </HStack>
      </VStack>
    </form>
  );
}

/**
 * Open change requests do not block an approval, but the Approve button asks first. It posts the
 * form itself (htmx reads `hx-confirm` from the element that sends the request, and Reject must
 * not ask), carrying the note and the verdict.
 */
function approveAnyway(url: string, open: number): Record<string, string> {
  return {
    "hx-post": url,
    "hx-target": "body",
    "hx-include": "closest form",
    "hx-vals": JSON.stringify({ verdict: "approved" }),
    "hx-confirm": `There are ${open} open change ${open === 1 ? "request" : "requests"}. Approve anyway?`,
  };
}

/** The status badge text: the build's status, worded for review. */
function standing(data: ReviewSectionData): string {
  const { status } = data.state;
  if (status === "pending") {
    return "waiting for review";
  }
  return BUILD_STATUSES.includes(status) ? status : "unknown";
}

/** One line on what decides the build. */
function summary(data: ReviewSectionData): string {
  const { state, testing } = data;
  if (testing) {
    return "Screenshots decide this build; a verdict is a sign-off and does not change its status.";
  }
  const needed = `${state.approvalsRequired} ${state.approvalsRequired === 1 ? "approval" : "approvals"}`;
  return `${state.approvals} of ${needed} given. Any rejection rejects the build. Open comments do not block a verdict.`;
}
