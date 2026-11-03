/** The change-request checklist of the build review page (ADR 0013): open requests, each linking to its anchor. */
import type { Comment } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { HtmlEscapedString } from "hono/utils/html";
import type { ReviewSectionData } from "../routers/review-section.handlers.ts";
import { getStore } from "../store.ts";
import { Card, Meta, SectionTitle, VStack } from "../ui/components.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** Characters of the comment shown beside its anchor. */
const EXCERPT_LENGTH = 80;

/** The change requests that are still open. */
export function openChangeRequests(data: Pick<ReviewSectionData, "changeRequests">): Comment[] {
  return data.changeRequests.filter((request) => !request.resolved);
}

/** "3 open change requests" (singular for one). */
export function openRequestsLabel(count: number): string {
  return `${count} open change ${count === 1 ? "request" : "requests"}`;
}

/** Open change requests, then the resolved ones folded away; nothing when there are none. */
export function ChangeRequestsCard(props: { data: ReviewSectionData }): Rendered | null {
  const { data } = props;
  if (data.changeRequests.length === 0) {
    return null;
  }
  const open = openChangeRequests(data);
  const resolved = data.changeRequests.filter((request) => request.resolved);
  return (
    <Card>
      <SectionTitle>Change requests</SectionTitle>
      {open.length === 0 ? (
        <Meta>All change requests are resolved.</Meta>
      ) : (
        <Entries data={data} requests={open} />
      )}
      {resolved.length === 0 ? null : (
        <details>
          <summary>Resolved ({resolved.length})</summary>
          <Entries data={data} requests={resolved} />
        </details>
      )}
    </Card>
  );
}

function Entries(props: { data: ReviewSectionData; requests: readonly Comment[] }): Rendered {
  const { data, requests } = props;
  return (
    <VStack>
      <ul>
        {requests.map((request): Rendered => (
          <Entry key={request.id} data={data} request={request} />
        ))}
      </ul>
    </VStack>
  );
}

function Entry(props: { data: ReviewSectionData; request: Comment }): Rendered {
  const { data, request } = props;
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  const href = request.snapshotId
    ? `${urls.snapshot(data.project.slug, data.build.id, request.snapshotId)}#comment-${request.id}`
    : `#comment-${request.id}`;
  const label = anchorLabel(data, request);
  const excerpt =
    request.body.length > EXCERPT_LENGTH
      ? `${request.body.slice(0, EXCERPT_LENGTH)}…`
      : request.body;
  const author = request.userId ? (data.names.get(request.userId) ?? request.userId) : "anonymous";
  return (
    <li>
      <a href={href}>{`${label}: ${excerpt}`}</a> <Meta as="span">{author}</Meta>
    </li>
  );
}

/** Where a change request is anchored, in words: the snapshot, the story, or the build. */
function anchorLabel(data: ReviewSectionData, request: Comment): string {
  if (request.snapshotId) {
    return data.snapshotLabels.get(request.snapshotId) ?? "Snapshot";
  }
  return request.storyId ?? "Build";
}
