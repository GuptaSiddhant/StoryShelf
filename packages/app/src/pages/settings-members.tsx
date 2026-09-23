import type { Project } from "@storyshelf/core/schema";
import type { ProjectGroupMapping } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Badge, Button, Card, Field, Meta, SectionTitle, SelectField } from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";

/** Project member row as rendered in the members settings tab. */
export interface SettingsMember {
  id: string;
  projectId: string;
  userId: string;
  role: string;
  createdAt: string;
}

/** Members settings tab: member roster plus the add-member form. */
export function renderSettingsMembers(
  project: Project,
  members: SettingsMember[],
  groupMappings: ProjectGroupMapping[],
  isAdmin: boolean,
): unknown {
  return (
    <div class="grid max-w-form">
      <Card>
        <SectionTitle>Members</SectionTitle>
        <Meta>Project members and their roles. Site admins have implicit admin access.</Meta>
        <div class="table-wrap table-gap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Since</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {members.map((member): HtmlEscapedString | Promise<HtmlEscapedString> => (
                <tr key={member.id}>
                  <td>
                    <code>{member.userId}</code>
                  </td>
                  <td>
                    <Badge
                      tone={
                        member.role === "admin"
                          ? "danger"
                          : member.role === "viewer"
                            ? "neutral"
                            : "info"
                      }
                    >
                      {member.role}
                    </Badge>
                  </td>
                  <td>{new Date(member.createdAt).toLocaleDateString()}</td>
                  <td>
                    {isAdmin ? (
                      <form
                        method="post"
                        action={`/projects/${project.slug}/settings/members/${member.userId}/remove`}
                        hx-post={`/projects/${project.slug}/settings/members/${member.userId}/remove`}
                        hx-target="body"
                      >
                        {csrfField()}
                        <Button variant="ghost" type="submit">
                          Remove
                        </Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {members.length === 0 ? <Meta>No members yet.</Meta> : null}
      </Card>

      {isAdmin ? (
        <Card>
          <SectionTitle level={3}>Add member</SectionTitle>
          <form
            method="post"
            action={`/projects/${project.slug}/settings/members`}
            hx-post={`/projects/${project.slug}/settings/members`}
            hx-target="body"
          >
            {csrfField()}
            <Field label="User ID" name="userId" required placeholder="user_..." />
            <SelectField
              label="Role"
              name="role"
              options={[
                { value: "viewer", label: "viewer" },
                { value: "developer", label: "developer" },
                { value: "approver", label: "approver" },
                { value: "admin", label: "admin" },
              ]}
            />
            <Button variant="primary" type="submit">
              Add member
            </Button>
          </form>
        </Card>
      ) : null}

      <div class="mt-1">
        <Card>
          <SectionTitle level={3}>Identity-provider group mappings</SectionTitle>
          <Meta>
            Map an IdP group (name or provider ID, exact match) to a project role. Members sync at
            next login; removing a mapping revokes synced grants but never manual ones. Wildcards
            are not expanded.
          </Meta>
          <div class="table-wrap table-gap">
            <table>
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Role</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {groupMappings.map((mapping): HtmlEscapedString | Promise<HtmlEscapedString> => (
                  <tr key={mapping.id}>
                    <td>
                      <code>{mapping.groupName}</code>
                    </td>
                    <td>
                      <Badge tone={mapping.role === "admin" ? "danger" : "info"}>
                        {mapping.role}
                      </Badge>
                    </td>
                    <td>
                      {isAdmin ? (
                        <form
                          method="post"
                          action={`/projects/${project.slug}/settings/members/groups/${mapping.id}/remove`}
                          hx-post={`/projects/${project.slug}/settings/members/groups/${mapping.id}/remove`}
                          hx-target="body"
                        >
                          {csrfField()}
                          <Button variant="ghost" type="submit">
                            Remove
                          </Button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {groupMappings.length === 0 ? <Meta>No group mappings yet.</Meta> : null}
        </Card>
      </div>

      {isAdmin ? (
        <div class="mt-1">
          <Card>
            <SectionTitle level={3}>Add group mapping</SectionTitle>
            <form
              method="post"
              action={`/projects/${project.slug}/settings/members/groups`}
              hx-post={`/projects/${project.slug}/settings/members/groups`}
              hx-target="body"
            >
              {csrfField()}
              <Field
                label="Group name or ID (exact match)"
                name="groupName"
                required
                placeholder="team-design"
              />
              <SelectField
                label="Role"
                name="role"
                options={[
                  { value: "viewer", label: "viewer" },
                  { value: "developer", label: "developer" },
                  { value: "approver", label: "approver" },
                  { value: "admin", label: "admin" },
                ]}
              />
              <Button variant="primary" type="submit">
                Add mapping
              </Button>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
