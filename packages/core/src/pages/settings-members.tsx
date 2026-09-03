import type { HtmlEscapedString } from "hono/utils/html";
import type { Project } from "../schema.ts";
import { Badge } from "../ui/components.tsx";

export interface SettingsMember {
  id: string;
  projectId: string;
  userId: string;
  role: string;
  createdAt: string;
}

export function renderSettingsMembers(project: Project, members: SettingsMember[], isAdmin: boolean): unknown {
  return (
    <div class="grid" style="max-width: 880px;">
      <div class="card card--padded">
        <h2 style="margin:0 0 .3rem;">Members</h2>
        <p class="field__hint">Project members and their roles. Site admins have implicit admin access.</p>
        <div class="table-wrap" style="margin-top:.75rem;">
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
              {members.map(
                (member): HtmlEscapedString => (
                  <tr key={member.id}>
                    <td>
                      <code>{member.userId}</code>
                    </td>
                    <td>
                      <Badge tone={member.role === "admin" ? "danger" : (member.role === "viewer" ? "neutral" : "info")}>{member.role}</Badge>
                    </td>
                    <td>{new Date(member.createdAt).toLocaleDateString()}</td>
                    <td>
                      {isAdmin ? (
                        <form method="post" action={`/projects/${project.slug}/settings/members/${member.userId}/remove`} hx-post={`/projects/${project.slug}/settings/members/${member.userId}/remove`} hx-target="body">
                          <button class="btn btn--ghost" type="submit">
                            Remove
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        {members.length === 0 ? <p class="field__hint" style="margin-top:.5rem;">No members yet.</p> : null}
      </div>

      {isAdmin ? (
        <div class="card card--padded">
          <h3 style="margin:0 0 .5rem;">Add member</h3>
          <form method="post" action={`/projects/${project.slug}/settings/members`} hx-post={`/projects/${project.slug}/settings/members`} hx-target="body">
            <div class="field">
              <label class="field__label" for="userId">
                User ID
              </label>
              <input class="field__input" id="userId" name="userId" required placeholder="user_..." />
            </div>
            <div class="field">
              <label class="field__label" for="role">
                Role
              </label>
              <select class="field__input" id="role" name="role">
                <option value="viewer">viewer</option>
                <option value="developer">developer</option>
                <option value="approver">approver</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <button class="btn btn--primary" type="submit">
              Add member
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}