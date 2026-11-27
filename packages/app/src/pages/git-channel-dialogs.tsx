/**
 * The move dialog of System › Git's per-project channels (ADR 0054, decision 8; ADR 0012, decision
 * 10): the channel, the connection to move it to, and why the last attempt did not move it. An HTMX
 * request gets the body alone; a plain request gets it on a page of its own.
 */
import type { HtmlEscapedString } from "hono/utils/html";
import { csrfField } from "../shell/csrf-field.tsx";
import {
  Alert,
  Button,
  DefinitionList,
  Form,
  FormActions,
  SelectField,
  VStack,
} from "../ui/components.tsx";
import {
  FROM_CHANNEL,
  type GitChannelMoveProblem,
  type GitChannelView,
} from "./admin-git-channels.tsx";

function ChannelFacts(props: {
  channel: GitChannelView;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { channel } = props;
  return (
    <DefinitionList
      items={[
        { label: "Repository", value: channel.repository },
        { label: "Project", value: channel.project?.name ?? "Removed" },
        { label: "Credential", value: `${channel.kindLabel} on ${channel.host}` },
        { label: "Status prefix", value: channel.prefix || "storyshelf (default)" },
      ]}
    />
  );
}

const PROBLEM_TEXT = {
  taken: "Another link or channel already posts to this repository with this prefix.",
  unfit: "That connection cannot take over this channel. Pick another one.",
  "bad-key":
    "The channel's stored key is not a usable App private key. Add the App by hand instead.",
} as const;

/** Why the last attempt did not move the channel; the channel is unchanged. */
function MoveProblemNotice(props: {
  problem: GitChannelMoveProblem | undefined;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const { problem } = props;
  if (problem === undefined) {
    return null;
  }
  if (problem.kind === "not-covered") {
    return (
      <Alert tone="warning" title="Not covered">
        The connection does not reach this repository, so nothing was moved.{" "}
        {problem.installUrl ? (
          <a href={problem.installUrl} rel="noreferrer">
            Install the App on it
          </a>
        ) : (
          "Give the connection access to it"
        )}
        , then try again.
      </Alert>
    );
  }
  const text =
    problem.kind === "unreachable"
      ? `The git host did not answer (${problem.detail}). Nothing was moved; try again later.`
      : PROBLEM_TEXT[problem.kind];
  return (
    <Alert tone="danger" title="Not moved">
      {text}
    </Alert>
  );
}

/** The connections the move can use: those that fit, then the channel's own App. */
function choicesOf(channel: GitChannelView): { value: string; label: string }[] {
  return [
    ...channel.connections.map((connection) => ({ value: connection.id, label: connection.name })),
    ...(channel.canCreate
      ? [{ value: FROM_CHANNEL, label: "New connection from this channel's App" }]
      : []),
  ];
}

/** Nothing can take the channel over yet: say which connection to add. */
function NoConnection(props: {
  channel: GitChannelView;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const kind = props.channel.kind === "gitlab-token" ? "gitlab-token" : "github-app";
  const what =
    kind === "gitlab-token"
      ? `a GitLab connection on ${props.channel.host}`
      : `a GitHub App connection on ${props.channel.host}`;
  return (
    <VStack>
      <Alert tone="info" title="Add a connection first">
        No connection can take this channel over. Add {what}, install it on the repository, then
        move the channel.
      </Alert>
      <FormActions>
        <Button variant="secondary" data-dialog-close>
          Cancel
        </Button>
        <Button href={`/admin/git/connections/new?kind=${kind}`}>Add connection</Button>
      </FormActions>
    </VStack>
  );
}

/** The move dialog's body: facts, the connection to move to, and Move. */
export function MoveChannelBody(props: {
  channel: GitChannelView;
  /** Where an answer is swapped: the dialog's body, or the whole page outside a dialog. */
  target: string;
  problem?: GitChannelMoveProblem | undefined;
  /** The connection picked last time. */
  selected?: string | undefined;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { channel, target, problem, selected } = props;
  const choices = choicesOf(channel);
  const path = `/admin/git/channels/${channel.id}/move`;
  return (
    <VStack>
      <ChannelFacts channel={channel} />
      <MoveProblemNotice problem={problem} />
      {choices.length === 0 ? (
        <NoConnection channel={channel} />
      ) : (
        <Form method="post" action={path} hx-post={path} hx-target={target}>
          {csrfField()}
          <input type="hidden" name="updatedAt" value={channel.updatedAt} />
          <SelectField
            label="Connection"
            name="connection"
            options={choices}
            value={selected}
            hint="The connection's coverage of the repository is checked first; nothing changes if it does not reach it."
          />
          <FormActions>
            <Button variant="secondary" data-dialog-close>
              Cancel
            </Button>
            <Button type="submit">Move</Button>
          </FormActions>
        </Form>
      )}
    </VStack>
  );
}
