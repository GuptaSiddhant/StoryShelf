import type { Project } from "@storyshelf/core/schema";
import type { ProjectGroupMapping } from "@storyshelf/core/schema";
import type { FC } from "hono/jsx";
import { csrfField } from "../shell/csrf-field.tsx";
import {
  Alert,
  Button,
  Card,
  DialogLink,
  Meta,
  SectionTitle,
  SummaryList,
  VStack,
  formatAbsolute,
  statusLabel,
  type SummaryItem,
} from "../ui/components.tsx";
import { FormDialog } from "./dialog-form.tsx";
import { ADD_GROUP_DIALOG, ADD_MEMBER_DIALOG } from "./member-forms.tsx";

/** Project member row as rendered in the members settings tab. */
export interface SettingsMember {
  id: string;
  projectId: string;
  userId: string;
  role: string;
  createdAt: string;
}

/** A Remove button that posts its own form (confirm first). */
const RemoveForm: FC<{ action: string; confirm: string }> = ({ action, confirm }) => {
  return (
    <form method="post" action={action} hx-post={action} hx-target="body" hx-confirm={confirm}>
      {csrfField()}
      <Button variant="danger-secondary" size="sm" type="submit">
        Remove
      </Button>
    </form>
  );
};

function memberItems(project: Project, members: SettingsMember[], isAdmin: boolean): SummaryItem[] {
  return members.map((member) => ({
    id: member.id,
    name: member.userId,
    state: { label: statusLabel(member.role), tone: "neutral" },
    details: `Since ${formatAbsolute(member.createdAt, "date")}`,
    actions: isAdmin ? (
      <RemoveForm
        action={`/projects/${project.slug}/settings/members/${member.userId}/remove`}
        confirm="Remove this member from the project?"
      />
    ) : undefined,
  }));
}

function mappingItems(
  project: Project,
  mappings: ProjectGroupMapping[],
  isAdmin: boolean,
): SummaryItem[] {
  return mappings.map((mapping) => ({
    id: mapping.id,
    name: mapping.groupName,
    state: { label: statusLabel(mapping.role), tone: "neutral" },
    actions: isAdmin ? (
      <RemoveForm
        action={`/projects/${project.slug}/settings/members/groups/${mapping.id}/remove`}
        confirm="Remove this group mapping?"
      />
    ) : undefined,
  }));
}

/** Members settings tab: the roster and the group mappings as summaries; adding opens a dialog. */
export function renderSettingsMembers(
  project: Project,
  members: SettingsMember[],
  groupMappings: ProjectGroupMapping[],
  isAdmin: boolean,
  formState?: { globalError?: string },
): unknown {
  const addMember = isAdmin ? (
    <DialogLink
      dialogId={ADD_MEMBER_DIALOG}
      variant="primary"
      icon="plus"
      href={`/projects/${project.slug}/settings/members/new`}
    >
      Add member
    </DialogLink>
  ) : undefined;
  const addMapping = isAdmin ? (
    <DialogLink
      dialogId={ADD_GROUP_DIALOG}
      variant="primary"
      icon="plus"
      href={`/projects/${project.slug}/settings/members/groups/new`}
    >
      Add group mapping
    </DialogLink>
  ) : undefined;
  return (
    <VStack>
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <Card>
        <SectionTitle>Members</SectionTitle>
        <Meta>Project members and their roles. Site admins have implicit admin access.</Meta>
        <SummaryList
          label="Members"
          items={memberItems(project, members, isAdmin)}
          emptyTitle="No members yet"
          emptyDescription="Add the people who work on this project."
          add={addMember}
        />
        {members.length > 0 ? addMember : null}
      </Card>
      <Card>
        <SectionTitle>Identity-provider group mappings</SectionTitle>
        <Meta>
          Map an IdP group (name or provider ID, exact match) to a project role. Members sync at
          next login; removing a mapping revokes synced grants but never manual ones. Wildcards are
          not expanded.
        </Meta>
        <SummaryList
          label="Identity-provider group mappings"
          items={mappingItems(project, groupMappings, isAdmin)}
          emptyTitle="No group mappings yet"
          add={addMapping}
        />
        {groupMappings.length > 0 ? addMapping : null}
      </Card>
      {isAdmin ? (
        <>
          <FormDialog id={ADD_MEMBER_DIALOG} title="Add member" submitLabel="Add member" />
          <FormDialog id={ADD_GROUP_DIALOG} title="Add group mapping" submitLabel="Add mapping" />
        </>
      ) : null}
    </VStack>
  );
}
