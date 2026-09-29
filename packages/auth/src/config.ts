/**
 * Auth config-as-code: validated, secret-safe engine options.
 *
 * Servers declare auth in code; secrets stay out of it via `{env:NAME}`
 * refs resolved at boot from `process.env` first, then the customer-owned
 * `resolveSecrets` hook (Vault/AWS/GCP/...). Precedence everywhere:
 * explicit literal > `{env}` ref > schema default, and code (`defaultSSO`,
 * recipes) > DB rows > plugin defaults at sign-in time.
 */
import { z } from "zod";
import type {
  ShelfAuthOptions,
  ShelfOAuthProvider,
  ShelfPasskeyOptions,
  ShelfSocialProvider,
  ShelfSSOGroupSync,
  ShelfSSOOidc,
  ShelfSSOProvider,
  ShelfSSOSaml,
} from "./engine.ts";

/** `{env:NAME}` reference (whole-string match; surrounding text is literal). */
const ENV_REF = /^\{env:(?<name>[A-Za-z_][A-Za-z0-9_]*)\}$/u;

/** Extract the variable name from an `{env:NAME}` ref, or null. */
export function parseEnvRef(value: string): string | null {
  return ENV_REF.exec(value)?.groups?.["name"] ?? null;
}

/**
 * Customer-owned secret backend (Vault/AWS/GCP/...). Called once per boot
 * with the ref names missing from `process.env`; return the values you hold.
 */
export interface ResolveSecrets {
  (
    names: string[],
  ): Promise<Record<string, string | undefined>> | Record<string, string | undefined>;
}

/** Input for {@link resolveAuthOptions} (refs allowed in any string field). */
export interface RawShelfAuthOptions extends Omit<ShelfAuthOptions, "plugins"> {
  /** Secret backend fallback for refs missing from `process.env`. */
  resolveSecrets?: ResolveSecrets;
  /** Custom Better Auth plugins (never validated; passed through by reference). */
  plugins?: ShelfAuthOptions["plugins"];
}

const socialSchema: z.ZodType<ShelfSocialProvider> = z.object({
  id: z.enum(["github", "gitlab", "google", "microsoft", "cognito"]),
  label: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  extra: z.record(z.string(), z.string().optional()).optional(),
});

const oauthSchema: z.ZodType<ShelfOAuthProvider> = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  discoveryUrl: z.string().optional(),
  authorizationUrl: z.string().optional(),
  tokenUrl: z.string().optional(),
  userInfoUrl: z.string().optional(),
  scopes: z.array(z.string().min(1)).optional(),
});

const ssoOidcSchema: z.ZodType<ShelfSSOOidc> = z.object({
  issuer: z.string().min(1),
  discoveryUrl: z.string().optional(),
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  scopes: z.array(z.string().min(1)).optional(),
  pkce: z.boolean().optional(),
});

const ssoSamlSchema: z.ZodType<ShelfSSOSaml> = z.object({
  issuer: z.string().min(1),
  entryPoint: z.string().min(1),
  cert: z.union([z.string(), z.array(z.string())]).optional(),
  metadataXml: z.string().optional(),
  entityID: z.string().optional(),
  audience: z.string().optional(),
  wantAssertionsSigned: z.boolean().optional(),
});

const ssoGroupsSchema: z.ZodType<ShelfSSOGroupSync> = z.object({
  claim: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  admins: z.array(z.string().min(1)).optional(),
});

const ssoProviderSchema: z.ZodType<ShelfSSOProvider> = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  domain: z.string().min(1),
  oidc: ssoOidcSchema.optional(),
  saml: ssoSamlSchema.optional(),
  groups: ssoGroupsSchema.optional(),
});

const passkeysSchema: z.ZodType<ShelfPasskeyOptions> = z.object({
  rpID: z.string().min(1).optional(),
  rpName: z.string().min(1).optional(),
  origin: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
});

/** Zod schema validating shelf auth options (before secret resolution). */
export const authOptionsSchema = z
  .object({
    db: z.custom<ShelfAuthOptions["db"]>((value) => typeof value === "object" && value !== null),
    // Any non-empty string (refs resolve later); the 32-char floor applies
    // to the resolved value (same threshold as the engine boot check).
    secret: z.string().min(1),
    // oxlint-disable-next-line typescript/no-deprecated -- z.string().url() kept for zod v3 API compat
    baseURL: z.string().url(),
    emailPassword: z.boolean().optional(),
    social: z.array(socialSchema).optional(),
    oauth: z.array(oauthSchema).optional(),
    sso: z
      .object({
        providers: z.array(ssoProviderSchema).min(1),
        disableImplicitSignUp: z.boolean().optional(),
      })
      .optional(),
    passkeys: passkeysSchema.optional(),
    sessionExpiresInDays: z.number().int().positive().optional(),
  })
  .strict() as z.ZodType<Omit<ShelfAuthOptions, "plugins">>;

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}

function collectFromValue(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectEnvNames(entry, into);
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) {
      collectEnvNames(entry, into);
    }
  }
}

function collectEnvNames(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    const name = parseEnvRef(value);
    if (name) {
      into.add(name);
    }
    return;
  }
  collectFromValue(value, into);
}

function substituteEnvNames(value: unknown, secrets: Map<string, string>): unknown {
  if (typeof value === "string") {
    const name = parseEnvRef(value);
    return name ? (secrets.get(name) ?? value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => substituteEnvNames(entry, secrets));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, substituteEnvNames(entry, secrets)]),
    );
  }
  return value;
}

/** Split ref names into env-held and hook-needed sets. */
function partitionSecretNames(names: Set<string>): {
  secrets: Map<string, string>;
  missing: string[];
} {
  const secrets = new Map<string, string>();
  const missing: string[] = [];
  for (const name of names) {
    const fromEnv = process.env[name];
    if (fromEnv) {
      secrets.set(name, fromEnv);
    } else {
      missing.push(name);
    }
  }
  return { secrets, missing };
}

/** Fill hook-provided values into the secret map. */
async function fillFromHook(
  secrets: Map<string, string>,
  missing: string[],
  hook: ResolveSecrets | undefined,
): Promise<void> {
  if (missing.length === 0 || !hook) {
    return;
  }
  const provided = await hook(missing);
  for (const name of missing) {
    if (provided[name]) {
      secrets.set(name, provided[name]);
    }
  }
}

/** Resolve `{env:NAME}` refs from the environment, then the hook. */
async function resolveSecretValues(
  names: Set<string>,
  hook: ResolveSecrets | undefined,
): Promise<Map<string, string>> {
  const { secrets, missing } = partitionSecretNames(names);
  await fillFromHook(secrets, missing, hook);
  const unsettled = [...names].filter((name) => !secrets.has(name));
  if (unsettled.length > 0) {
    throw new Error(
      `Shelf auth secrets missing: ${unsettled.join(", ")} (set the env vars or provide resolveSecrets)`,
    );
  }
  return secrets;
}

/**
 * Secret-bearing subtrees: `db` (live adapter with circular drizzle handles)
 * and `plugins` (class instances) pass through by reference and are never
 * walked or cloned — refs only make sense in plain config data.
 */
function secretSubtrees(options: Omit<ShelfAuthOptions, "plugins">): Record<string, unknown> {
  const { db: _db, ...rest } = options as Omit<ShelfAuthOptions, "plugins"> & {
    db: unknown;
  };
  return rest;
}

function parseRawOptions(input: RawShelfAuthOptions): {
  options: Omit<ShelfAuthOptions, "plugins">;
  plugins: ShelfAuthOptions["plugins"];
  resolveSecrets: ResolveSecrets | undefined;
} {
  const { resolveSecrets, plugins, ...rest } = input;
  const parsed = authOptionsSchema.safeParse(rest);
  if (!parsed.success) {
    throw new Error(`Invalid shelf auth options: ${formatIssues(parsed.error)}`);
  }
  return { options: parsed.data, plugins, resolveSecrets };
}

/**
 * Validate auth options and resolve `{env:NAME}` secret refs.
 *
 * @param input - Raw options (refs allowed in any string field) plus the
 * optional customer-owned `resolveSecrets` fallback.
 * @returns Engine-ready options for {@link createShelfAuth}.
 */
/** Collect `{env:}` refs and resolve their values (empty when none). */
async function collectSecrets(
  options: Omit<ShelfAuthOptions, "plugins">,
  hook: ResolveSecrets | undefined,
): Promise<Record<string, unknown>> {
  const names = new Set<string>();
  collectEnvNames(secretSubtrees(options), names);
  if (names.size === 0) {
    return {};
  }
  const values = await resolveSecretValues(names, hook);
  return substituteEnvNames(secretSubtrees(options), values) as Record<string, unknown>;
}

export async function resolveAuthOptions(input: RawShelfAuthOptions): Promise<ShelfAuthOptions> {
  const { options, plugins, resolveSecrets } = parseRawOptions(input);
  const secrets = await collectSecrets(options, resolveSecrets);
  const resolved = { ...options, ...secrets } as Omit<ShelfAuthOptions, "plugins">;
  if (resolved.secret.length < 32) {
    throw new Error("Shelf auth requires a secret of at least 32 characters");
  }
  return { ...resolved, ...(plugins ? { plugins } : {}) };
}
