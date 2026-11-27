// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone } from "../../.storybook/page.tsx";
import { jsxStory } from "../../.storybook/render.tsx";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  HStack,
  LiveStatus,
  Meta as MetaText,
  Stat,
  VStack,
  statusLabel,
  statusTone,
} from "./components.tsx";

const meta: Meta = { title: "UI/Feedback" };
export default meta;

const tones = ["neutral", "success", "warning", "danger", "info", "quiet"] as const;

export const Badges = jsxStory(() => (
  <VStack>
    <HStack>
      {tones.map((tone) => (
        <Badge key={tone} tone={tone}>
          {tone}
        </Badge>
      ))}
    </HStack>
    <HStack>
      {tones.map((tone) => (
        <Badge key={tone} tone={tone} icon>
          {tone}
        </Badge>
      ))}
    </HStack>
  </VStack>
));

/** A status column: the quiet badge shares height, padding and icon slot with the pills. */
export const QuietAlignedWithPills = jsxStory(() => (
  <VStack gap="sm" align="start">
    <Badge tone="quiet" icon>
      Approved
    </Badge>
    <Badge tone="warning" icon>
      Needs review
    </Badge>
    <Badge tone="danger" icon>
      Failed
    </Badge>
  </VStack>
));

export const BuildStatusBadges = jsxStory(() => (
  <HStack>
    {[
      "approved",
      "unchanged",
      "reviewing",
      "new",
      "changed",
      "rejected",
      "failed",
      "pending",
      "cancelled",
      "skipped",
    ].map((status) => (
      <Badge key={status} tone={statusTone(status)} icon>
        {statusLabel(status)}
      </Badge>
    ))}
  </HStack>
));

export const Alerts = jsxStory(() => (
  <VStack>
    {tones
      .filter((tone) => tone !== "quiet")
      .map((tone) => (
        <Alert key={tone} tone={tone} title={`${tone[0]?.toUpperCase()}${tone.slice(1)} alert`}>
          A short explanation of what happened and what to do next.
        </Alert>
      ))}
  </VStack>
));

export const AlertWithoutTitle = jsxStory(() => (
  <Alert tone="warning">This build is not the latest one for its branch.</Alert>
));

export const EmptyStates = jsxStory(() => (
  <VStack gap="lg">
    <EmptyState title="No builds yet" description="Upload a Storybook to create the first build." />
    <EmptyState
      title="No design links"
      description="Link a Figma file to compare stories with their design."
      action={<Button variant="secondary">Link a design</Button>}
    />
    <EmptyState title="Nothing to review" />
  </VStack>
));

export const Stats = jsxStory(() => (
  <HStack gap="lg">
    <Stat label="Components" value={42} />
    <Stat label="Approved" value={36} tone="success" />
    <Stat label="Needing attention" value={6} tone="warning" />
    <Stat label="Needs attention · Unavailable" value={null} />
    <Stat label="Coverage" value="86%" />
  </HStack>
));

export const MetaStyles = jsxStory(() => (
  <VStack>
    <MetaText>Default muted text for hints and captions.</MetaText>
    <MetaText tone="danger">Danger tone for a failed check.</MetaText>
    <MetaText mono>mono: src/Button.stories.tsx</MetaText>
    <MetaText center>Centered text</MetaText>
    <MetaText as="code">as code: abc1234</MetaText>
    <MetaText as="pre">{"as pre:\n  line one\n  line two"}</MetaText>
  </VStack>
));

/** Roles, providers and verdicts read in sentence case, like build statuses. */
/** A long unbroken value wraps inside the 375px phone viewport instead of widening the page (#1259). */
export const MetaCodeLongOnAPhone = onAPhone(
  jsxStory(() => (
    <MetaText as="code">
      {
        '{"buildId":"01M7YHE2SYBV237RNQ0SVGSPW8","attemptNo":1,"queue":"main","reason":"lease expired"}'
      }
    </MetaText>
  )),
);

/** A link in running text is underlined, so colour is not the only cue (WCAG 1.4.1, #1259). */
export const LinkInText = jsxStory(() => (
  <VStack>
    <MetaText>
      Confirm the address on the <a href="/admin">System page</a> to turn notifications on.
    </MetaText>
    <Alert tone="info">
      Some integrations are not offered. See <a href="/admin#integrations">System</a>.
    </Alert>
  </VStack>
));

export const SentenceCaseLabels = jsxStory(() => (
  <HStack>
    {["admin", "viewer", "via password", "github", "slack", "error", "resolved"].map((label) => (
      <Badge key={label}>{statusLabel(label)}</Badge>
    ))}
  </HStack>
));

/** A live status line takes no room until a script writes into it (no blank band under a button). */
export const LiveStatusEmptyAndFilled = jsxStory(() => (
  <VStack>
    <Button variant="secondary">Sign in with a passkey</Button>
    <LiveStatus hook="story-empty-status" />
    <MetaText>Above: an empty status line (no gap). Below: one with a message.</MetaText>
    <Button variant="secondary">Register a passkey</Button>
    <MetaText>Waiting for your device…</MetaText>
  </VStack>
));
