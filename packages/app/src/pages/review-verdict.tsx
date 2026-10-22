/** The verdict card of the build page: where the build stands, the verdicts, and the reviewer's controls. */
import { BUILD_STATUSES } from "@storyshelf/core/types";
import type { HtmlEscapedString } from "hono/utils/html";
import type { ReviewSectionData } from "../routers/review-section.handlers.ts";
import {
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
import { csrfField } from "../ui/csrf-field.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** Build-level verdicts: the approvals so far, each reviewer's latest verdict, and the controls. */
export function VerdictCard(props: { data: ReviewSectionData }): Rendered {
  const { data } = props;
  return (
    <Card>
      <HStack justify="between">
        <SectionTitle>Review</SectionTitle>
        <Badge tone={statusTone(data.state.status)}>{standing(data)}</Badge>
      </HStack>
      <Meta>{summary(data)}</Meta>
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
      {data.canVerdict && data.build.status !== "failed" ? <VerdictForm data={data} /> : null}
    </Card>
  );
}

/** The reviewer's controls: an optional note and the two verdicts. */
function VerdictForm(props: { data: ReviewSectionData }): Rendered {
  const { project, build } = props.data;
  const url = `/projects/${project.slug}/builds/${build.id}/reviews`;
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
          <Button variant="primary" type="submit" name="verdict" value="approved">
            Approve build
          </Button>
          <Button variant="danger" type="submit" name="verdict" value="rejected">
            Reject build
          </Button>
        </HStack>
      </VStack>
    </form>
  );
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
