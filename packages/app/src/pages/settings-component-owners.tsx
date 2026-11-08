import { ownerRulesText, type OwnerProblem, type OwnerRule } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { FC } from "hono/jsx";
import { csrfField } from "../shell/csrf-field.tsx";
import {
  Alert,
  Button,
  Card,
  FormActions,
  HStack,
  Meta,
  SectionTitle,
  Table,
  TextareaField,
} from "../ui/components.tsx";

/** What the owners card shows beyond the saved rules: a refused submission, kept as typed. */
export interface OwnersFormState {
  /** The text the admin submitted, shown again so they can fix and resubmit. */
  ownerText?: string;
  /** Why nothing was saved, one per line of the text. */
  ownerProblems?: OwnerProblem[];
}

const HINT =
  "One rule per line: a glob, then the members who own it. A component with several owners notifies all of them. A story file can match several rules; all their owners are assigned.";
const PLACEHOLDER = "src/components/forms/**  user_01H  user_02J";

/** The saved rules as a read-only table (pattern and owners). */
const RulesTable: FC<{ rules: readonly OwnerRule[] }> = (props) => {
  return (
    <Table label="Component owner rules">
      <table>
        <thead>
          <tr>
            <th>Pattern</th>
            <th>Owners</th>
          </tr>
        </thead>
        <tbody>
          {props.rules.map((rule) => (
            <tr key={rule.pattern}>
              <td>
                <code>{rule.pattern}</code>
              </td>
              <td>
                <HStack gap="sm">
                  {rule.owners.map((owner) => (
                    <code key={owner}>{owner}</code>
                  ))}
                </HStack>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Table>
  );
};

/** The refusal of a save: one line per problem, nothing was stored. */
const ProblemsAlert: FC<{ problems: readonly OwnerProblem[] }> = (props) => {
  return (
    <Alert tone="danger" title="Couldn't save the owners">
      <ul>
        {props.problems.map((problem) => (
          <li key={`${problem.line}:${problem.message}`}>
            Line {problem.line}: {problem.message}
          </li>
        ))}
      </ul>
    </Alert>
  );
};

/** The edit form (admins): a CODEOWNERS-style textarea and one save button. */
const OwnersForm: FC<{
  project: Project;
  text: string;
  problems: readonly OwnerProblem[];
}> = (props) => {
  const action = `/projects/${props.project.slug}/settings/members/owners`;
  return (
    <form method="post" action={action} hx-post={action} hx-target="body">
      {csrfField()}
      {props.problems.length > 0 ? <ProblemsAlert problems={props.problems} /> : null}
      <TextareaField
        label="Owner rules"
        name="owners"
        value={props.text}
        placeholder={PLACEHOLDER}
        rows={8}
        hint={HINT}
      />
      <FormActions>
        <Button variant="primary" type="submit">
          Save owners
        </Button>
      </FormActions>
    </form>
  );
};

/**
 * Component owners on the Members tab (#465): who is asked to review a build that changes a
 * component. Admins edit; everyone else sees the saved rules. Nothing renders while review is off.
 */
export const ComponentOwnersCard: FC<{
  project: Project;
  rules: readonly OwnerRule[];
  isAdmin: boolean;
  formState?: OwnersFormState;
}> = (props) => {
  const { project, rules, isAdmin, formState } = props;
  if (project.reviewEnabled === false) {
    return null;
  }
  const text = formState?.ownerText ?? ownerRulesText(rules);
  return (
    <Card>
      <SectionTitle level={3}>Component owners</SectionTitle>
      <Meta>
        Reviews of changed components go to their owners. Others who can approve may still approve.
      </Meta>
      {isAdmin ? (
        <OwnersForm project={project} text={text} problems={formState?.ownerProblems ?? []} />
      ) : (
        <Meta>Only project admins can change this.</Meta>
      )}
      {rules.length === 0 ? (
        <Meta>No component owners yet. Reviews go to the default approvers.</Meta>
      ) : isAdmin ? null : (
        <RulesTable rules={rules} />
      )}
    </Card>
  );
};
