import type { Project } from "@storyshelf/core/schema";
import type { ProjectGroupMapping } from "@storyshelf/core/schema";
import type { User } from "@storyshelf/core/schema";
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
  /** What the roster shows for the member: the display name, else the profile name, else the email. */
  name: string;
  /** The member's sign-in email, or null when the member has no account row. */
  email: string | null;
}

/**
 * The name and email a roster row shows for a member. A name that is an address is not shown as a
 * name (sign-in paths without a profile name store the email there), and a member with no account
 * row is "Unknown user", never their id.
 */
export function memberIdentityOf(
  user: Pick<User, "email" | "name" | "displayNameOverride"> | null,
): Pick<SettingsMember, "name" | "email"> {
  if (!user) {
    return { name: "Unknown user", email: null };
  }
  const named = [user.displayNameOverride, user.name].find(
    (value): value is string =>
      typeof value === "string" && value.trim() !== "" && !value.includes("@"),
  );
  return { name: named?.trim() ?? user.email, email: user.email };
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
    name: member.name,
    state: { label: statusLabel(member.role), tone: "neutral" },
    details: `${member.email && member.email !== member.name ? `${member.email} · ` : ""}Since ${formatAbsolute(member.createdAt, "date")}`,
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
  const addMember = (primary: boolean): unknown =>
    isAdmin ? (
      <DialogLink
        dialogId={ADD_MEMBER_DIALOG}
        variant={primary ? "primary" : "secondary"}
        size={primary ? "md" : "sm"}
        icon="plus"
        href={`/projects/${project.slug}/settings/members/new`}
      >
        Add member
      </DialogLink>
    ) : undefined;
  const addMapping = (primary: boolean): unknown =>
    isAdmin ? (
      <DialogLink
        dialogId={ADD_GROUP_DIALOG}
        variant={primary ? "primary" : "secondary"}
        size={primary ? "md" : "sm"}
        icon="plus"
        href={`/projects/${project.slug}/settings/members/groups/new`}
      >
        Add group mapping
      </DialogLink>
    ) : undefined;
  return (
    <VStack gap="lg">
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <Card>
        <SectionTitle actions={members.length > 0 ? addMember(false) : null}>Members</SectionTitle>
        <Meta>Project members and their roles. Site admins have implicit admin access.</Meta>
        <SummaryList
          label="Members"
          items={memberItems(project, members, isAdmin)}
          emptyTitle="No members yet"
          emptyDescription="Add the people who work on this project."
          add={addMember(true)}
        />
      </Card>
      <Card>
        <SectionTitle actions={groupMappings.length > 0 ? addMapping(false) : null}>
          Identity-provider group mappings
        </SectionTitle>
        <Meta>
          Map an IdP group (name or provider ID, exact match) to a project role. Members sync at
          next login; removing a mapping revokes synced grants but never manual ones. Wildcards are
          not expanded.
        </Meta>
        <SummaryList
          label="Identity-provider group mappings"
          items={mappingItems(project, groupMappings, isAdmin)}
          emptyTitle="No group mappings yet"
          add={addMapping(true)}
        />
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
