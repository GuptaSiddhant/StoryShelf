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
| Database | Cloud SQL Postgres 16, **private IP only**, TLS required (or your own URL)          |
| Storage  | GCS bucket: private, versioned, public access prevented                             |
| Secrets  | Secret Manager: `SECRET`, `ADMIN_TOKEN` and the database URL                        |
| Image    | Artifact Registry remote repository that proxies ghcr.io (Cloud Run cannot pull it) |

The module enables the APIs it needs (`run`, `storage`, `secretmanager`, `artifactregistry`, and
`sqladmin`, `servicenetworking`, `compute` for the database) and leaves them on at destroy.

## Inputs

| Name                                | Default            | Meaning                                                                       |
| ----------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `name`                              | required           | Name prefix, 2-20 characters                                                  |
| `project_id`                        | required           | GCP project                                                                   |
| `image_version`                     | required           | Release version of the image (no `v`)                                         |
| `region`                            | `us-central1`      | Must match the provider's region                                              |
| `image_repository`                  | `""`               | A full registry path (your mirror). Empty creates the ghcr.io proxy           |
| `public_base_url`                   | `""`               | `PUBLIC_BASE_URL`, e.g. for a domain you map yourself                         |
| `network` / `subnetwork`            | `""`               | Existing VPC and subnet (self links). Empty creates them                      |
| `cpu` / `memory`                    | `2` / `4Gi`        | Capture renders in the container: do not go much lower                        |
| `min_instances` / `max_instances`   | `1` / `1`          | Identical copies; every copy serves and consumes the queue (ADR 0006)         |
| `database_pool_size`                | `10`               | Connections per copy: `max_instances` x this must fit the database's limit    |
| `shutdown_grace_seconds`            | `8`                | See "Shutdown"                                                                |
| `existing_database_url_secret_id`   | `""`               | A Postgres URL in Secret Manager; no database is created                      |
| `database_tier`                     | `db-custom-1-3840` | Created database only                                                         |
| `database_disk_size_gb`             | `10`               | Created database only                                                         |
| `deletion_protection`               | `true`             | Protects the database and service; `false` also empties the bucket on destroy |
| `remote_browser_endpoint_secret_id` | `""`               | Optional remote browser (secret reference)                                    |
| `remote_browser_token_secret_id`    | `""`               | Optional remote browser token (secret reference)                              |
| `labels`                            | `{}`               | Added to every resource that supports them                                    |

## Outputs

`url`, `service_name`, `gcs_bucket`, `db_instance`, `db_private_ip`, `database_url_secret_id`,
`admin_token_secret_id`, `service_account_email` and `service_account_roles`. Secret outputs are
Secret Manager ids (references), never values; the database URL and its password are not an output.

## Secrets

Secrets reach Cloud Run as Secret Manager references (`value_source.secret_key_ref`).

- **`SECRET`, `ADMIN_TOKEN`** and the database password are generated. Their values are also in the
  Terraform state: keep the state in an encrypted backend with restricted access.
- Read the admin token with
  `gcloud secrets versions access latest --secret "$(terraform output -raw admin_token_secret_id)"`.
- **Existing database:** put a `postgres://` URL in a secret and pass its id as
  `existing_database_url_secret_id`. The module creates no database or private services range. Set
  `network` and `subnetwork` if the database is private; the network path is yours.

## Service account roles

The app runs as `service_account_email` with exactly these grants (output `service_account_roles`).
Nothing is granted at project level:

| Resource                                                                                    | Role                                 |
| ------------------------------------------------------------------------------------------- | ------------------------------------ |
| The storybook bucket                                                                        | `roles/storage.objectUser`           |
| Each app secret (`SECRET`, `ADMIN_TOKEN`, the database URL, and any remote-browser secrets) | `roles/secretmanager.secretAccessor` |

Cloud Run writes the container's logs itself, and the database is reached over its private IP with a
password from Secret Manager, so no logging or Cloud SQL role is needed. The service is public
(`allUsers` has `roles/run.invoker`) because the app has its own sign-in.

## Database

Cloud SQL has **no public IP** (`ipv4_enabled = false`, `ssl_mode = ENCRYPTED_ONLY`). It takes a
private address from a reserved range through private services access, and Cloud Run reaches it with
Direct VPC egress (`PRIVATE_RANGES_ONLY`, so only private traffic uses the VPC). Remove access by
destroying the stack; there is no firewall rule to loosen.

## Capture, scaling and shutdown

- **Capture runs in the container** (the image ships Chromium). For a remote browser, put its
  endpoint and token in Secret Manager and pass the two ids; they become `REMOTE_BROWSER_ENDPOINT`
  and `REMOTE_BROWSER_TOKEN`. The module builds no browser service.
- **The queue consumers poll in the background**, so the service sets `cpu_idle = false` (CPU stays
  allocated between requests) and `min_instances >= 1` (validated). Without them captures stall.
  Cloud Run is not detected as serverless by the app (`K_SERVICE` is set); this setting is what makes
  it correct.
- **Scaling** is more identical copies between `min_instances` and `max_instances`. Per-copy limits
  (remote-browser connections, rate limits, the AI budget) are in the scaling docs.
- **Shutdown.** Cloud Run sends SIGTERM and stops the container 10 seconds later; that period is not
  configurable. The app drains running captures for `shutdown_grace_seconds`
  (`SHUTDOWN_GRACE_SECONDS`, 1-9, default 8), then hands the rest back to the queue.

## Domain and TLS

The service has the `*.run.app` HTTPS origin. For your own domain, map it yourself (a load balancer or
a Cloud Run domain mapping) and pass `public_base_url`.

## Image contract

| Variable                                          | Source                               | Status  |
| ------------------------------------------------- | ------------------------------------ | ------- |
| `PUBLIC_BASE_URL`, `TRUST_PROXY`                  | module                               | read    |
| `DATABASE_URL`, `DATABASE_POOL_MAX`               | Secret Manager, `database_pool_size` | read    |
| `SECRET`, `ADMIN_TOKEN`                           | Secret Manager                       | read    |
| `GCS_BUCKET`, `GOOGLE_CLOUD_PROJECT`              | the created bucket                   | pending |
| `SHUTDOWN_GRACE_SECONDS`                          | `shutdown_grace_seconds`             | read    |
| `REMOTE_BROWSER_ENDPOINT`, `REMOTE_BROWSER_TOKEN` | secret references                    | pending |

_Pending_ variables are set by the module but read by the image only once it wires them: until the
image selects GCS from `GCS_BUCKET`, the nightly apply stays off (see Checks).

## Checks

CI runs `terraform fmt -check`, `terraform validate` and `tflint` on every module under
`deploy/terraform`. The nightly live-cloud workflow applies `examples/minimal` with the current
release image, smoke-tests it and destroys it.
