// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  HStack,
  Meta as MetaText,
  Stat,
  VStack,
  statusTone,
} from "./components.tsx";

const meta: Meta = { title: "UI/Feedback" };
export default meta;

const tones = ["neutral", "success", "warning", "danger", "info"] as const;

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

export const BuildStatusBadges = jsxStory(() => (
  <HStack>
    {[
      "approved",
      "unchanged",
      "new",
      "changed",
      "rejected",
      "failed",
      "pending",
      "cancelled",
      "skipped",
    ].map((status) => (
      <Badge key={status} tone={statusTone(status)} icon>
        {status}
      </Badge>
    ))}
  </HStack>
));

export const Alerts = jsxStory(() => (
  <VStack>
    {tones.map((tone) => (
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
