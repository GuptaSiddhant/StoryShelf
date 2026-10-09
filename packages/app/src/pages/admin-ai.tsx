import type { HtmlEscapedString } from "hono/utils/html";
import type { UsageReport } from "../insights/usage-report.ts";
import {
  Card,
  EmptyState,
  Meta,
  PageHeader,
  SectionTitle,
  Stat,
  Table,
} from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

function DaysTable(props: {
  days: UsageReport["days"];
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <Table dense>
      <table>
        <thead>
          <tr>
            <th>Day</th>
            <th>Tokens</th>
            <th>Calls</th>
            <th>Failed</th>
          </tr>
        </thead>
        <tbody>
          {props.days.map((day) => (
            <tr>
              <td>{day.day}</td>
              <td>{day.tokens}</td>
              <td>{day.calls}</td>
              <td>{day.failed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Table>
  );
}

function ProfilesTable(props: {
  profiles: UsageReport["profiles"];
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <Table dense>
      <table>
        <thead>
          <tr>
            <th>Profile</th>
            <th>Tokens</th>
            <th>Calls</th>
          </tr>
        </thead>
        <tbody>
          {props.profiles.map((profile) => (
            <tr>
              <td>{profile.profile}</td>
              <td>{profile.tokens}</td>
              <td>{profile.calls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Table>
  );
}

/** Site-admin AI usage page: today's budget position and the last days by profile. */
export function renderAdminAiPage(report: UsageReport): RenderedContent {
  const cap = report.dailyTokens;
  const today =
    cap === null ? `${report.todayTokens} tokens` : `${report.todayTokens} / ${cap} tokens`;
  return (
    <DocumentLayout title="AI usage" nav={{ active: "admin" }}>
      <PageHeader
        title="AI usage"
        description="Tokens counted toward the daily budget (UTC days). Visible to site admins only."
      />
      <Card>
        <Stat label="Today" value={today} />
      </Card>
      {report.days.length === 0 ? (
        <EmptyState
          title="No usage yet"
          description="AI calls appear here after the first insight runs."
        />
      ) : (
        <>
          <SectionTitle level={3}>By day</SectionTitle>
          <DaysTable days={report.days} />
          <SectionTitle level={3}>By profile</SectionTitle>
          <ProfilesTable profiles={report.profiles} />
          <Meta>
            Rows older than 90 days are purged. Failed calls the provider billed still count.
          </Meta>
        </>
      )}
    </DocumentLayout>
  );
}
