import { summarizeTests, type TestResult } from "@storyshelf/core/capture";
import type { HtmlEscapedString } from "hono/utils/html";
import { Badge, Card, HStack, Meta, SectionTitle, VStack } from "../ui/components.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** The line under the card title: counts, and what a failure means for the build. */
export function testsSummaryNote(results: readonly TestResult[]): string {
  const { total, passed, failed } = summarizeTests(results);
  if (total === 0) {
    return "No Storybook tests ran.";
  }
  return failed > 0
    ? `${failed} of ${total} failed. A failing test fails the build, like a failing play function.`
    : `All ${passed} passed.`;
}

/**
 * The build's Storybook `.test()` results: failures first with their message, passes behind a
 * disclosure. Null when the build ran no tests (project setting off, or none in the Storybook).
 */
export function TestsCard(props: { results: readonly TestResult[] }): Rendered | null {
  if (props.results.length === 0) {
    return null;
  }
  const failed = props.results.filter((result) => result.status === "failed");
  const passed = props.results.filter((result) => result.status === "passed");
  return (
    <Card>
      <SectionTitle>Storybook tests</SectionTitle>
      <HStack>
        <Badge tone={failed.length > 0 ? "danger" : "success"}>
          {failed.length > 0 ? `${failed.length} failed` : "all passed"}
        </Badge>
        <Meta as="span">
          {passed.length} passed · {failed.length} failed
        </Meta>
      </HStack>
      <Meta>{testsSummaryNote(props.results)}</Meta>
      <VStack>
        {failed.map((result) => (
          <TestRow key={result.id} result={result} />
        ))}
      </VStack>
      {passed.length > 0 ? (
        <details>
          <summary>Passed tests ({passed.length})</summary>
          <VStack>
            {passed.map((result) => (
              <TestRow key={result.id} result={result} />
            ))}
          </VStack>
        </details>
      ) : null}
    </Card>
  );
}

function TestRow(props: { result: TestResult }): Rendered {
  const { result } = props;
  return (
    <VStack gap="sm">
      <HStack align="baseline" wrap={false}>
        <Badge tone={result.status === "failed" ? "danger" : "success"}>{result.status}</Badge>
        <span>
          {result.title} <Meta as="span">/ {result.name}</Meta>
        </span>
      </HStack>
      {result.error ? <Meta as="pre">{result.error}</Meta> : null}
    </VStack>
  );
}
