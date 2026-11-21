// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { project } from "../stories-fixtures/dataset.ts";
import {
  AddChannelForm,
  ADD_CHANNEL_DIALOG,
  EDIT_CHANNEL_DIALOG,
  EditChannelForm,
} from "./channel-forms.tsx";
import {
  ADD_DESIGN_FILE_DIALOG,
  AddDesignFileForm,
  DESIGN_TOKEN_DIALOG,
  DesignTokenForm,
  MAP_COMPONENT_DIALOG,
  MapComponentForm,
} from "./design-forms.tsx";
import { FormDialog } from "./dialog-form.tsx";
import {
  ADD_GROUP_DIALOG,
  ADD_MEMBER_DIALOG,
  AddGroupMappingForm,
  AddMemberForm,
} from "./member-forms.tsx";
import {
  EDIT_GENERAL_DIALOG,
  EDIT_REVIEW_DIALOG,
  EditGeneralForm,
  EditReviewForm,
} from "./project-forms.tsx";
import {
  ADD_WEBHOOK_DIALOG,
  AddWebhookForm,
  CREATE_TOKEN_DIALOG,
  CreateTokenForm,
} from "./token-forms.tsx";

const meta: Meta = { title: "Pages/Settings/Forms" };
export default meta;

const kinds = [
  { kind: "email", name: "Email" },
  { kind: "slack-webhook", name: "Slack" },
  { kind: "teams-webhook", name: "Teams" },
];

const figma = { kind: "figma", name: "Figma", credentialLabel: "Figma personal access token" };
const URL_HINT = "https://www.figma.com/design/…";

/** Add member: the email and the role. */
export const AddMember = jsxStory(() => (
  <FormDialog id={ADD_MEMBER_DIALOG} title="Add member" submitLabel="Add member" open>
    <AddMemberForm project={project} standalone={false} />
  </FormDialog>
));

/** Add member, refused: nobody has that email. */
export const AddMemberError = jsxStory(() => (
  <FormDialog id={ADD_MEMBER_DIALOG} title="Add member" submitLabel="Add member" open>
    <AddMemberForm
      project={project}
      standalone={false}
      error="No account has the email ana@example.com. They need to sign in once first."
    />
  </FormDialog>
));

/** Add group mapping. */
export const AddGroupMapping = jsxStory(() => (
  <FormDialog id={ADD_GROUP_DIALOG} title="Add group mapping" submitLabel="Add mapping" open>
    <AddGroupMappingForm project={project} standalone={false} />
  </FormDialog>
));

/** Create token. */
export const CreateToken = jsxStory(() => (
  <FormDialog id={CREATE_TOKEN_DIALOG} title="Create token" submitLabel="Create token" open>
    <CreateTokenForm project={project} standalone={false} />
  </FormDialog>
));

/** Create token, refused: a name is required. */
export const CreateTokenError = jsxStory(() => (
  <FormDialog id={CREATE_TOKEN_DIALOG} title="Create token" submitLabel="Create token" open>
    <CreateTokenForm project={project} standalone={false} error="Name is required" />
  </FormDialog>
));

/** Add webhook. */
export const AddWebhook = jsxStory(() => (
  <FormDialog id={ADD_WEBHOOK_DIALOG} title="Add webhook" submitLabel="Add webhook" open>
    <AddWebhookForm project={project} standalone={false} />
  </FormDialog>
));

/** Add webhook, refused: the address is private. */
export const AddWebhookError = jsxStory(() => (
  <FormDialog id={ADD_WEBHOOK_DIALOG} title="Add webhook" submitLabel="Add webhook" open>
    <AddWebhookForm project={project} standalone={false} error="That address is not allowed" />
  </FormDialog>
));

/** Add channel, email selected: only the address field shows. */
export const AddChannelEmail = jsxStory(() => (
  <FormDialog id={ADD_CHANNEL_DIALOG} title="Add channel" submitLabel="Add channel" open>
    <AddChannelForm
      project={project}
      kinds={kinds}
      standalone={false}
      state={{ selected: "email" }}
    />
  </FormDialog>
));

/** Add channel, a chat kind selected: the webhook URL field shows. */
export const AddChannelSlack = jsxStory(() => (
  <FormDialog id={ADD_CHANNEL_DIALOG} title="Add channel" submitLabel="Add channel" open>
    <AddChannelForm
      project={project}
      kinds={kinds}
      standalone={false}
      state={{ selected: "slack-webhook" }}
    />
  </FormDialog>
));

/** Add channel, refused: the webhook URL is not allowed. */
export const AddChannelError = jsxStory(() => (
  <FormDialog id={ADD_CHANNEL_DIALOG} title="Add channel" submitLabel="Add channel" open>
    <AddChannelForm
      project={project}
      kinds={kinds}
      standalone={false}
      state={{
        selected: "slack-webhook",
        errors: { target: "That address is not allowed" },
        events: "build.approved",
      }}
    />
  </FormDialog>
));

/** Edit an email channel: the kind is fixed, the address is shown. */
export const EditChannelEmail = jsxStory(() => (
  <FormDialog id={EDIT_CHANNEL_DIALOG} title="Edit channel" submitLabel="Save channel" open>
    <EditChannelForm
      project={project}
      channelId="c1"
      kind="email"
      kindName="email"
      standalone={false}
      state={{ to: "team@example.com", events: "build.approved", style: "verbose" }}
    />
  </FormDialog>
));

/** Edit a chat channel: a blank URL keeps the stored one. */
export const EditChannelSlack = jsxStory(() => (
  <FormDialog id={EDIT_CHANNEL_DIALOG} title="Edit channel" submitLabel="Save channel" open>
    <EditChannelForm
      project={project}
      channelId="c2"
      kind="slack-webhook"
      kindName="Slack"
      standalone={false}
      state={{}}
    />
  </FormDialog>
));

/** Edit the project. */
export const EditGeneral = jsxStory(() => (
  <FormDialog id={EDIT_GENERAL_DIALOG} title="Edit project" submitLabel="Save changes" open>
    <EditGeneralForm project={project} standalone={false} />
  </FormDialog>
));

/** Edit the project, refused: a name is required. */
export const EditGeneralError = jsxStory(() => (
  <FormDialog id={EDIT_GENERAL_DIALOG} title="Edit project" submitLabel="Save changes" open>
    <EditGeneralForm project={project} standalone={false} errors={{ name: "Name is required" }} />
  </FormDialog>
));

/** Edit review. */
export const EditReview = jsxStory(() => (
  <FormDialog id={EDIT_REVIEW_DIALOG} title="Edit review" submitLabel="Save review settings" open>
    <EditReviewForm project={project} standalone={false} />
  </FormDialog>
));

/** Edit review, refused: the approvals count is out of range. */
export const EditReviewError = jsxStory(() => (
  <FormDialog id={EDIT_REVIEW_DIALOG} title="Edit review" submitLabel="Save review settings" open>
    <EditReviewForm
      project={project}
      standalone={false}
      errors={{ reviewApprovals: "Enter a whole number from 1 to 20" }}
    />
  </FormDialog>
));

/** Add a design file. */
export const AddDesignFile = jsxStory(() => (
  <FormDialog
    id={ADD_DESIGN_FILE_DIALOG}
    title="Add design file"
    submitLabel="Add design file"
    open
  >
    <AddDesignFileForm project={project} standalone={false} urlHint={URL_HINT} />
  </FormDialog>
));

/** Map a component, refused: the URL is not a design link. */
export const MapComponentError = jsxStory(() => (
  <FormDialog id={MAP_COMPONENT_DIALOG} title="Map component" submitLabel="Map component" open>
    <MapComponentForm
      project={project}
      standalone={false}
      urlHint={URL_HINT}
      error="That is not a Figma link"
    />
  </FormDialog>
));

/** Set a provider token. */
export const SetDesignToken = jsxStory(() => (
  <FormDialog id={DESIGN_TOKEN_DIALOG} title="Design token" submitLabel="Save token" open>
    <DesignTokenForm project={project} provider={figma} replace={false} standalone={false} />
  </FormDialog>
));

/** Rotate a provider token, refused. */
export const RotateDesignTokenError = jsxStory(() => (
  <FormDialog id={DESIGN_TOKEN_DIALOG} title="Design token" submitLabel="Rotate token" open>
    <DesignTokenForm
      project={project}
      provider={figma}
      replace
      standalone={false}
      error="Token is required"
    />
  </FormDialog>
));
