import type { FC } from "hono/jsx";
import type { GitHostProvider } from "../adapters/git-host/index.ts";
import type { Project } from "../schema.ts";
import { Badge, Field, SelectField, TextareaField } from "../ui/components.tsx";

/** Git status configuration row as rendered in the status settings tab. */
export interface SettingsStatusConfig {
  id: string;
  provider: string;
  config: Record<string, unknown>;
  hasToken: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Form state for the git status settings tab. */
export interface StatusFormState {
  errors?: Record<string, string>;
  globalError?: string;
}

/* eslint-disable promise-function-async -- JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

function providerOptions(providers: GitHostProvider[]): { value: string; label: string }[] {
  return providers.map((provider) => ({ value: provider.metadata.kind, label: provider.metadata.name }));
}

const StatusConfigRow: FC<{
  config: SettingsStatusConfig;
  provider: GitHostProvider | undefined;
  project: Project;
  isAdmin: boolean;
}> = ({ config, provider, project, isAdmin }) => {
  const rendered = JSON.stringify(config.config);
  return (
    <tr key={config.id}>
      <td>{provider?.metadata.name ?? config.provider}</td>
      <td style="max-width:32ch; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title={rendered}>
        <code>{rendered}</code>
      </td>
      <td>{config.hasToken ? <Badge tone="success">configured</Badge> : <Badge tone="danger">missing</Badge>}</td>
      <td>{new Date(config.createdAt).toLocaleDateString()}</td>
      <td>
        {isAdmin ? (
          <form method="post" action={`/projects/${project.slug}/settings/status/${config.id}/delete`} hx-post={`/projects/${project.slug}/settings/status/${config.id}/delete`} hx-target="body">
            <button class="btn btn--ghost" type="submit">
              Delete
            </button>
          </form>
        ) : null}
      </td>
    </tr>
  );
};

const StatusCreateCard: FC<{
  project: Project;
  providers: GitHostProvider[];
  formState?: StatusFormState;
}> = ({ project, providers, formState }) => {
  return (
    <div class="card card--padded">
      <h3 style="margin:0 0 .5rem;">Add git provider</h3>
      <form method="post" action={`/projects/${project.slug}/settings/status`} hx-post={`/projects/${project.slug}/settings/status`} hx-target="body">
        <SelectField label="Provider" name="provider" options={providerOptions(providers)} hint="Integration that posts commit statuses for this project." />
        <Field label="Token" name="token" type="password" required placeholder="ghp_…" error={formState?.errors?.["token"]} hint="Scoped token for the provider (e.g. a GitHub PAT with repo:status)." />
        <TextareaField
          label="Config"
          name="config"
          rows={6}
          placeholder='{"owner":"my-org","repo":"my-repo"}'
          error={formState?.errors?.["config"]}
          hint="JSON configuration for the provider. See the provider documentation for its fields."
        />
        <button class="btn btn--primary" type="submit">
          Add git provider
        </button>
      </form>
    </div>
  );
};

function renderCreateSection(project: Project, providers: GitHostProvider[], formState?: StatusFormState): unknown {
  if (providers.length === 0) {
    return <p class="field__hint">No git providers registered on this server.</p>;
  }
  return <StatusCreateCard project={project} providers={providers} formState={formState} />;
}

/** Git status settings tab: configured providers plus the add-provider form. */
// eslint-disable-next-line max-params -- matches sibling settings render functions
export function renderSettingsStatus(
  project: Project,
  statusConfigs: SettingsStatusConfig[],
  providers: GitHostProvider[],
  isAdmin: boolean,
  formState?: StatusFormState,
): unknown {
  const byProvider = new Map(providers.map((provider) => [provider.metadata.kind, provider]));
  return (
    <div class="grid" style="max-width: 880px;">
      {formState?.globalError ? (
        <div class="alert alert--danger" role="alert">
          {formState.globalError}
        </div>
      ) : null}

      <div class="card card--padded">
        <h2 style="margin:0 0 .3rem;">Git status</h2>
        <p class="field__hint">
          Post commit statuses to a git provider so visual tests show up in your PR checks. Status is reported for each configured provider: pending while
          capturing, success on approval, failure on rejection or capture errors.
        </p>
        <div class="table-wrap" style="margin-top:.75rem;">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Config</th>
                <th>Token</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {statusConfigs.map((config) => (
                <StatusConfigRow key={config.id} config={config} provider={byProvider.get(config.provider)} project={project} isAdmin={isAdmin} />
              ))}
            </tbody>
          </table>
        </div>
        {statusConfigs.length === 0 ? <p class="field__hint" style="margin-top:.5rem;">No git providers configured for this project.</p> : null}
      </div>

      {isAdmin ? renderCreateSection(project, providers, formState) : null}
    </div>
  );
}