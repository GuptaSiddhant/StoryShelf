# StoryShelf on Google Cloud (Terraform module)

Runs the published StoryShelf image (`ghcr.io/guptasiddhant/storyshelf`) on Cloud Run, with Cloud SQL
Postgres on a private IP, a GCS bucket and Secret Manager. It builds no image. ADR 0050 describes
the decision; this page is the reference.

## Use it

Pin a release with a git source (`?ref=v<version>`), and give `image_version` the same version:

```hcl
module "storyshelf" {
  source = "git::https://github.com/GuptaSiddhant/StoryShelf.git//deploy/terraform/gcp?ref=v0.12.0"

  name          = "storyshelf"
  project_id    = "my-gcp-project"
  region        = "us-central1"
  image_version = "0.12.0"
}
```

Each stable release also attaches `storyshelf-terraform-<version>.tar.gz` (the whole
`deploy/terraform/` folder). Upgrade by changing both versions together. A runnable example is in
`examples/minimal/`.

## What it creates

| Part     | Resources                                                                           |
| -------- | ----------------------------------------------------------------------------------- |
| Network  | VPC and subnet for Direct VPC egress, private services range (or your own network)  |
| Compute  | One Cloud Run service of identical copies, running as its own service account       |
| Database | Cloud SQL Postgres 16, **private IP only**, TLS verified (or your own URL)          |
| Storage  | GCS bucket: private, versioned, public access prevented                             |
| Secrets  | Secret Manager: `SECRET`, `AUTH_PASSWORD`, `ADMIN_TOKEN` and the database URL       |
| Image    | Artifact Registry remote repository that proxies ghcr.io (Cloud Run cannot pull it) |

The module enables the APIs it needs (`run`, `storage`, `secretmanager`, `artifactregistry`, and
`sqladmin`, `servicenetworking`, `compute` for the database) and leaves them on at destroy.

## Inputs

| Name                                                 | Default             | Meaning                                                                                  |
| ---------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| `name`                                               | required            | Name prefix, 2-20 characters                                                             |
| `project_id`                                         | required            | GCP project                                                                              |
| `image_version`                                      | required            | Release version of the image (no `v`)                                                    |
| `region`                                             | `us-central1`       | Must match the provider's region                                                         |
| `image_repository`                                   | `""`                | A full registry path (your mirror). Empty creates the ghcr.io proxy                      |
| `public_base_url`                                    | `""`                | `PUBLIC_BASE_URL` for a domain you map yourself; empty means the service's `run.app` URL |
| `network` / `subnetwork`                             | `""`                | Existing VPC and subnet (self links). Empty creates them                                 |
| `cpu` / `memory`                                     | `2` / `4Gi`         | Capture renders in the container: do not go much lower                                   |
| `min_instances` / `max_instances`                    | `1` / `1`           | Identical copies; every copy serves and consumes the queue (ADR 0006)                    |
| `database_pool_size`                                 | `10`                | Connections per copy: `max_instances` x this must fit the database's limit               |
| `shutdown_grace_seconds`                             | `8`                 | See "Shutdown"                                                                           |
| `existing_database_url_secret_id`                    | `""`                | A Postgres URL in Secret Manager; no database is created                                 |
| `database_tier`                                      | `db-custom-1-3840`  | Created database only                                                                    |
| `database_disk_size_gb`                              | `10`                | Created database only                                                                    |
| `deletion_protection`                                | `true`              | Protects the database and service; `false` also empties the bucket on destroy            |
| `github_app_id` / `github_app_private_key_secret_id` | `""`                | Server-wide GitHub App connection (both or none; see "Git connections")                  |
| `github_api_url`                                     | `""`                | GitHub Enterprise Server API base; empty means github.com                                |
| `gitlab_token_secret_id` / `gitlab_token_expires`    | `""`                | Server-wide GitLab connection (both or none)                                             |
| `gitlab_host`                                        | `""`                | GitLab base URL; empty means gitlab.com                                                  |
| `auth_email`                                         | `admin@example.com` | Local admin login email (`AUTH_EMAIL`)                                                   |
| `labels`                                             | `{}`                | Added to every resource that supports them                                               |

## Outputs

`url`, `service_name`, `gcs_bucket`, `db_instance`, `db_private_ip`, `database_url_secret_id`,
`admin_token_secret_id`, `auth_password_secret_id`, `service_account_email` and `service_account_roles`. Secret outputs are
Secret Manager ids (references), never values; the database URL and its password are not an output.

## Secrets

Secrets reach Cloud Run as Secret Manager references (`value_source.secret_key_ref`).

- **`SECRET`, `AUTH_PASSWORD`, `ADMIN_TOKEN`** and the database password are generated. Their values
  are also in the Terraform state: keep the state in an encrypted backend with restricted access.
- **Sign-in.** The image turns sign-in on from `AUTH_PASSWORD` and `SECRET`, and the module always
  sets both, so the app never boots open. Read the password with
  `gcloud secrets versions access latest --secret "$(terraform output -raw auth_password_secret_id)"`
  and sign in as `admin@example.com` (or `auth_email`).
- Read the admin token with
  `gcloud secrets versions access latest --secret "$(terraform output -raw admin_token_secret_id)"`.
- **Existing database:** put a `postgres://` URL in a secret and pass its id as
  `existing_database_url_secret_id`. The module creates no database or private services range. Set
  `network` and `subnetwork` if the database is private; the network path is yours.

## Service account roles

The app runs as `service_account_email` with exactly these grants (output `service_account_roles`).
Nothing is granted at project level:

| Resource                                                                                      | Role                                 |
| --------------------------------------------------------------------------------------------- | ------------------------------------ |
| The storybook bucket                                                                          | `roles/storage.objectUser`           |
| Each app secret (`SECRET`, `AUTH_PASSWORD`, `ADMIN_TOKEN`, the database URL, any git secrets) | `roles/secretmanager.secretAccessor` |

Cloud Run writes the container's logs itself, and the database is reached over its private IP with a
password from Secret Manager, so no logging or Cloud SQL role is needed. Anyone can reach the
service (`allUsers` has `roles/run.invoker`, ingress from all), so the app's sign-in is its only
gate: the module generates `AUTH_PASSWORD`, and the image refuses to boot without it. Put Cloud Armor
or IAP in front yourself if the service must not be reachable at all.

## Database

Cloud SQL has **no public IP** (`ipv4_enabled = false`, `ssl_mode = ENCRYPTED_ONLY`). It takes a
private address from a reserved range through private services access, and Cloud Run reaches it with
Direct VPC egress (`PRIVATE_RANGES_ONLY`, so only private traffic uses the VPC). Remove access by
destroying the stack; there is no firewall rule to loosen.

**The app verifies the server certificate.** The instance uses a CAS-issued server certificate
(`server_ca_mode = GOOGLE_MANAGED_CAS_CA`), the URL says `sslmode=verify-full`, and the module passes
the instance's CA as `DATABASE_CA`, so the password is never sent to a peer that cannot prove it is
the instance. The URL connects by the private IP, which the CAS certificate names; there is no DNS
record for the instance on private services access. _Unverified:_ no live run has confirmed the
certificate check against a real instance yet. An existing database URL brings its own TLS settings
(see the deployment docs, "Verify the database certificate").

## Capture, scaling and shutdown

- **Capture runs in the container** (the image ships Chromium). The module builds no browser
  service, and has no remote-browser input until the image reads one from its environment.
- **The queue consumers poll in the background**, so the service sets `cpu_idle = false` (CPU stays
  allocated between requests) and `min_instances >= 1` (validated). Without them captures stall.
  The serverless check (`isServerlessHost`) looks only for AWS Lambda, Vercel and Netlify, so it
  never warns on Cloud Run (which sets `K_SERVICE`); these two settings are what keep captures running.
- **Scaling** is more identical copies between `min_instances` and `max_instances`. Per-copy limits
  (remote-browser connections, rate limits, the AI budget) are in the scaling docs.
- **Shutdown.** Cloud Run sends SIGTERM and stops the container 10 seconds later; that period is not
  configurable. The app drains running captures for `shutdown_grace_seconds`
  (`SHUTDOWN_GRACE_SECONDS`, 1-8, default 8), then hands the rest back to the queue. The process
  forces its exit 1 second after the drain, so even the largest value leaves 1 second of margin inside
  Cloud Run's window. A copy killed anyway loses its lease: the job is retried unless
  that attempt was its last one, in which case the job fails, its build fails and admins are alerted.

## Domain and TLS

The service has the `*.run.app` HTTPS origin. For your own domain, map it yourself (a load balancer or
a Cloud Run domain mapping) and pass `public_base_url`. Without it the app gets the service's
deterministic URL (`https://<name>-app-<project number>.<region>.run.app`), so session cookies are
`Secure` and links point at the real origin.

## Git connections

Optional, for merge gates and pull-request comments without anyone pasting a key (ADR 0054). Create
the GitHub App's private key, or a GitLab group or project access token (`api` scope), as a
Secret Manager secret yourself, then pass its reference. Terraform holds only the reference, so the key
and the token never enter configuration or state; the app reads them as
`SHELF_GITHUB_APP_PRIVATE_KEY` and `SHELF_GITLAB_TOKEN`. The service account gets `roles/secretmanager.secretAccessor` on exactly these secrets. A half-set connection fails the plan,
and the image refuses to boot on one too, naming the variable and never its value. Rotating a key is
a new secret version and a new revision.

```sh
gcloud secrets create shelf-github-app-key --data-file=app.private-key.pem
```

## Image contract

| Variable                                                                                         | Source                               | Status |
| ------------------------------------------------------------------------------------------------ | ------------------------------------ | ------ |
| `PUBLIC_BASE_URL`, `TRUST_PROXY`, `AUTH_EMAIL`                                                   | module                               | read   |
| `DATABASE_CA`                                                                                    | the created instance's server CA     | read   |
| `DATABASE_URL`, `DATABASE_POOL_MAX`                                                              | Secret Manager, `database_pool_size` | read   |
| `SECRET`, `AUTH_PASSWORD`, `ADMIN_TOKEN`                                                         | Secret Manager                       | read   |
| `GCS_BUCKET`, `GOOGLE_CLOUD_PROJECT`                                                             | the created bucket                   | read   |
| `SHUTDOWN_GRACE_SECONDS`                                                                         | `shutdown_grace_seconds`             | read   |
| `SHELF_GITHUB_APP_ID`, `SHELF_GITHUB_API_URL`, `SHELF_GITLAB_HOST`, `SHELF_GITLAB_TOKEN_EXPIRES` | git inputs (optional)                | read   |
| `SHELF_GITHUB_APP_PRIVATE_KEY`, `SHELF_GITLAB_TOKEN`                                             | Secret Manager references (optional) | read   |

The image selects Google Cloud Storage from `GCS_BUCKET` (credentials from the service account via
Application Default Credentials) and refuses to boot when another storage backend is also set. The live apply stays behind the
repository variable `LIVE_GCP_MODULE_APPLY`: it is billed, so the owner turns it on. No live GCP run has
confirmed this path yet; the adapter is tested against a faked SDK.

## Checks

CI runs `terraform fmt -check`, `terraform validate` and `tflint` on every module under
`deploy/terraform`. The nightly live-cloud workflow applies `examples/minimal` with the current
release image, smoke-tests it and destroys it.
