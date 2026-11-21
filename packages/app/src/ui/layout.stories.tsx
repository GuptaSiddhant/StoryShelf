// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import {
  Badge,
  Button,
  Card,
  CardSection,
  FilterInput,
  HStack,
  Meta as MetaText,
  PageHeader,
  SectionTitle,
  SelectField,
  Stat,
  StatGroup,
  Table,
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

/** A card's children are one flow: title, text and table sit one gap apart, none touching. */
export const CardFlow = jsxStory(() => (
  <Card>
    <SectionTitle>Adapters</SectionTitle>
    <MetaText>Live probe per adapter, refreshed on every load.</MetaText>
    <Table label="Adapters">
      <table>
        <thead>
          <tr>
            <th>Adapter</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Database</td>
            <td>
              <Badge tone="success">Healthy</Badge>
            </td>
          </tr>
          <tr>
            <td>Storage</td>
            <td>
              <Badge tone="warning">Slow</Badge>
            </td>
          </tr>
        </tbody>
      </table>
    </Table>
  </Card>
));

/** Stats stay a row down to phone width. */
export const StatRow = jsxStory(() => (
  <Card>
    <SectionTitle>Server</SectionTitle>
    <StatGroup>
      <Stat label="Status" value="Healthy" tone="success" />
      <Stat label="Uptime" value="3 d" />
      <Stat label="Version" value="1.4.0" />
    </StatGroup>
  </Card>
));

/** One toolbar, one height: filter, select and buttons share a size. */
export const Toolbar = jsxStory(() => (
  <HStack>
    <FilterInput label="Filter components" />
    <SelectField
      label="Branch"
      name="toolbar-branch"
      value="main"
      layout="inline"
      options={[
        { value: "main", label: "main" },
        { value: "next", label: "next" },
      ]}
    />
    <Button variant="secondary">View Storybook</Button>
    <Button>View</Button>
  </HStack>
));
