import type { Project } from "@storyshelf/core/schema";
import type { FC } from "hono/jsx";
import { Alert, Field, SelectField, statusLabel } from "../ui/components.tsx";
import { DialogForm } from "./dialog-form.tsx";

const ROLES = ["viewer", "developer", "approver", "admin"] as const;
const roleOptions = ROLES.map((role) => ({ value: role, label: statusLabel(role) }));

/** Dialog ids of the member forms. */
export const ADD_MEMBER_DIALOG = "add-member";
export const ADD_GROUP_DIALOG = "add-group-mapping";

interface FormProps {
  project: Project;
  standalone: boolean;
  error?: string | undefined;
}

/** The add-member form: in the dialog, or on its own page. */
export const AddMemberForm: FC<FormProps> = ({ project, standalone, error }) => {
  return (
    <DialogForm
      dialog={ADD_MEMBER_DIALOG}
      action={`/projects/${project.slug}/settings/members`}
      submitLabel="Add member"
      standalone={standalone}
      backHref={`/projects/${project.slug}/settings/access#members`}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Email" name="email" type="email" required placeholder="name@example.com" />
      <SelectField label="Project role" name="role" options={roleOptions} />
    </DialogForm>
  );
};

/** The add-group-mapping form: in the dialog, or on its own page. */
export const AddGroupMappingForm: FC<FormProps> = ({ project, standalone, error }) => {
  return (
    <DialogForm
      dialog={ADD_GROUP_DIALOG}
      action={`/projects/${project.slug}/settings/members/groups`}
      submitLabel="Add mapping"
      standalone={standalone}
      backHref={`/projects/${project.slug}/settings/access#members`}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field
        label="Group name or ID (exact match)"
        name="groupName"
        required
        placeholder="team-design"
      />
      <SelectField label="Role for group members" name="role" options={roleOptions} />
    </DialogForm>
  );
};
