import type { Project } from "@storyshelf/core/schema";
import type { FC } from "hono/jsx";
import { Alert, Field, OptionFields, SelectField, statusLabel } from "../ui/components.tsx";
import { DialogForm } from "./dialog-form.tsx";

/** Dialog ids of the message-channel forms. */
export const ADD_CHANNEL_DIALOG = "add-channel";
export const EDIT_CHANNEL_DIALOG = "edit-channel";

/** A message kind the server offers, as the Add form lists it. */
export interface ChannelKind {
  kind: string;
  name: string;
}

/** What an Add or Edit form re-renders with after a refusal. */
export interface ChannelFormState {
  error?: string | undefined;
  /** Field errors by name (`target`, `provider`). */
  errors?: Record<string, string> | undefined;
  /** The kind that was selected, kept on a refusal. */
  selected?: string | undefined;
  events?: string | undefined;
  style?: string | undefined;
}

const STYLES = [
  { value: "compact", label: "Compact" },
  { value: "verbose", label: "Verbose" },
];

/** Email takes an address; every other message kind takes a webhook URL. */
function targetField(
  kind: string,
  state: ChannelFormState,
  options?: { optional?: boolean; hint?: string },
): unknown {
  const email = kind === "email";
  return (
    <Field
      label={email ? "Email address" : "Webhook URL"}
      name="target"
      id={`target-${kind}`}
      type={email ? "email" : "url"}
      required={options?.optional !== true}
      placeholder={email ? "team@example.com" : "https://hooks.example.com/…"}
      hint={options?.hint ?? (email ? undefined : "Stored encrypted; shown nowhere after saving.")}
      error={state.errors?.["target"]}
    />
  );
}

const CommonFields: FC<{ state: ChannelFormState }> = ({ state }) => (
  <>
    <Field
      label="Events"
      name="events"
      value={state.events ?? ""}
      placeholder="build.reviewing, build.approved"
      hint="Comma-separated. Leave blank to receive all events."
    />
    <SelectField label="Style" name="style" options={STYLES} value={state.style ?? "compact"} />
  </>
);

/** The add-channel form: the kind is a choice, and each kind shows only its own field. */
export const AddChannelForm: FC<{
  project: Project;
  kinds: ChannelKind[];
  standalone: boolean;
  state?: ChannelFormState;
}> = ({ project, kinds, standalone, state = {} }) => {
  return (
    <DialogForm
      dialog={ADD_CHANNEL_DIALOG}
      action={`/projects/${project.slug}/settings/notifications`}
      submitLabel="Add channel"
      standalone={standalone}
      backHref={`/projects/${project.slug}/settings/review#notifications`}
    >
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.errors?.["provider"] ? <Alert tone="danger">{state.errors["provider"]}</Alert> : null}
      <OptionFields
        name="provider"
        label="Channel"
        selected={state.selected}
        options={kinds.map((entry) => ({
          value: entry.kind,
          label: entry.name,
          children: targetField(entry.kind, entry.kind === state.selected ? state : {}),
        }))}
      />
      <CommonFields state={state} />
    </DialogForm>
  );
};

/** The edit-channel form: the kind is fixed; a blank URL keeps the stored one. */
export const EditChannelForm: FC<{
  project: Project;
  channelId: string;
  kind: string;
  kindName: string;
  standalone: boolean;
  state: ChannelFormState & { to?: string | undefined };
}> = ({ project, channelId, kind, kindName, standalone, state }) => {
  const email = kind === "email";
  return (
    <DialogForm
      dialog={EDIT_CHANNEL_DIALOG}
      action={`/projects/${project.slug}/settings/notifications/${channelId}/edit`}
      submitLabel="Save channel"
      standalone={standalone}
      backHref={`/projects/${project.slug}/settings/review#channel-${channelId}`}
    >
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <Field label="Channel" name="kindLabel" value={statusLabel(kindName)} disabled />
      {email ? (
        <Field
          label="Email address"
          name="target"
          type="email"
          required
          value={state.to ?? ""}
          error={state.errors?.["target"]}
        />
      ) : (
        targetField(kind, state, {
          optional: true,
          hint: "Leave blank to keep the current URL. It is stored encrypted and never shown.",
        })
      )}
      <CommonFields state={state} />
    </DialogForm>
  );
};
