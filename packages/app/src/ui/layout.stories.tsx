// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import {
  Badge,
  Button,
  Card,
  CardSection,
  HStack,
  Meta as MetaText,
  PageHeader,
  SectionTitle,
  VStack,
} from "./components.tsx";

const meta: Meta = { title: "UI/Layout" };
export default meta;

export const PageHeaders = jsxStory(() => (
  <VStack gap="lg">
    <PageHeader title="Library" />
    <PageHeader title="Library" description="Components of the latest accepted build." />
    <PageHeader
      title="Build a1b2c3d"
      description="feature/button-radius"
      meta="Captured 2 d ago · 128 snapshots"
      actions={
        <HStack>
          <Button variant="secondary">Retry</Button>
          <Button>Approve all</Button>
        </HStack>
      }
    />
  </VStack>
));

export const Cards = jsxStory(() => (
  <VStack gap="lg">
    <Card>
      <SectionTitle>Padded card</SectionTitle>
      <MetaText>The default container.</MetaText>
    </Card>
    <Card padded={false}>
      <CardSection divider>
        <SectionTitle level={3}>Unpadded, with sections</SectionTitle>
      </CardSection>
      <CardSection>
        <MetaText>Sections own the padding and an optional divider.</MetaText>
      </CardSection>
    </Card>
    <Card tone="danger">
      <SectionTitle tone="danger">Danger zone</SectionTitle>
      <MetaText>Deleting a project cannot be undone.</MetaText>
      <Button variant="danger">Delete project</Button>
    </Card>
  </VStack>
));

export const FillCards = jsxStory(() => (
  <div class="grid grid--2">
    <Card fill>
      <SectionTitle level={3}>Short</SectionTitle>
      <MetaText>Fills its cell.</MetaText>
    </Card>
    <Card fill>
      <SectionTitle level={3}>Taller neighbour</SectionTitle>
      <MetaText>Equal-height cards let a footer sit at the bottom.</MetaText>
      <Badge tone="info">footer</Badge>
    </Card>
  </div>
));

export const SectionTitles = jsxStory(() => (
  <VStack>
    <SectionTitle>Level 2 (default)</SectionTitle>
    <SectionTitle level={3}>Level 3</SectionTitle>
    <SectionTitle tone="danger">Danger</SectionTitle>
    <SectionTitle level={3} tone="danger">
      Danger level 3
    </SectionTitle>
  </VStack>
));
