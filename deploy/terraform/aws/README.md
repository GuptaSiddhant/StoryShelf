# StoryShelf on AWS (Terraform module)

Runs the published StoryShelf image (`ghcr.io/guptasiddhant/storyshelf`) on ECS Fargate behind an
ALB, with RDS Postgres, S3, Cognito and CloudWatch. It builds no image and pushes nothing to ECR.
ADR 0050 describes the decision; this page is the reference.

## Use it

Pin a release with a git source (`?ref=v<version>`), and give `image_version` the same version:

```hcl
module "storyshelf" {
  source = "git::https://github.com/GuptaSiddhant/StoryShelf.git//deploy/terraform/aws?ref=v0.12.0"

  name                = "storyshelf"
  region              = "us-east-1"
  image_version       = "0.12.0"
  domain_name         = "shelf.example.com"
  allowed_cidr_blocks = ["203.0.113.0/24"] # your office or VPN; ["0.0.0.0/0"] publishes the app
}
```

Each stable release also attaches `storyshelf-terraform-<version>.tar.gz` (the whole
`deploy/terraform/` folder) for installs that cannot fetch from GitHub. Upgrade by changing both
versions together and reading the release notes. A runnable example is in `examples/minimal/`.

## What it creates

| Part     | Resources                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------- |
| Network  | VPC with 2 public and 2 private subnets (or your own `vpc_id`), no NAT gateway                           |
| Compute  | ECS cluster, one Fargate service of identical copies, ALB, CPU autoscaling                               |
| Database | RDS Postgres in private subnets, IAM authentication on (or your own URL)                                 |
| Storage  | S3 bucket: private, versioned, encrypted, TLS only                                                       |
| Identity | Optional (`enable_cognito`): Cognito user pool, app client, SAML federation                              |
| Secrets  | Secrets Manager: `SHELF_SECRET`, `SHELF_ADMIN_PASSWORD`, `SHELF_ADMIN_TOKEN`, `SHELF_OIDC_CLIENT_SECRET` |
| DNS      | With `domain_name`: Route 53 zone, ACM certificate, HTTPS listener                                       |
| Logs     | CloudWatch log group                                                                                     |

Tasks run in the public subnets with a public IP (to pull the image and reach AWS APIs) and their
security group admits only the ALB. The database is reachable from the task security group only.

## Inputs

| Name                                                                                  | Default                                   | Meaning                                                                                                        |
| ------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `name`                                                                                | required                                  | Name prefix, 2-20 characters                                                                                   |
| `image_version`                                                                       | required                                  | Release version of the image (no `v`)                                                                          |
| `region`                                                                              | `us-east-1`                               | Must match the provider's region                                                                               |
| `image_repository`                                                                    | `ghcr.io/guptasiddhant/storyshelf`        | Registry path, for a mirror                                                                                    |
| `vpc_id`                                                                              | `""`                                      | Existing VPC; subnets are found by their `Tier` tag (`public`, `private`)                                      |
| `allowed_cidr_blocks`                                                                 | required                                  | IPv4 ranges that may reach the load balancer; `["0.0.0.0/0"]` publishes the app                                |
| `allow_http`                                                                          | `false`                                   | Plain HTTP without a domain; the plan fails otherwise                                                          |
| `domain_name`                                                                         | `""`                                      | Enables HTTPS (see "Domain and TLS")                                                                           |
| `saml_metadata_url`                                                                   | `""`                                      | Cognito SAML federation                                                                                        |
| `task_cpu` / `task_memory`                                                            | `2048` / `4096`                           | Capture renders in the container: do not go much lower                                                         |
| `min_instances` / `max_instances`                                                     | `1` / `1`                                 | Identical copies; every copy serves and consumes the queue (ADR 0006)                                          |
| `database_pool_size`                                                                  | `10`                                      | Connections per copy: `max_instances` x this must fit the database's limit                                     |
| `shutdown_grace_seconds`                                                              | `30`                                      | See "Shutdown"                                                                                                 |
| `existing_database_url_secret_arn`                                                    | `""`                                      | A Postgres URL in Secrets Manager; no database is created                                                      |
| `database_instance_class`                                                             | `db.t4g.micro`                            | Created database only                                                                                          |
| `database_allocated_storage`                                                          | `20`                                      | GiB, created database only                                                                                     |
| `database_backup_retention_days`                                                      | `7`                                       | Automated backup retention in days (1-35)                                                                      |
| `database_init_image`                                                                 | ECR Public `postgres:16-alpine` by digest | Image of the `db-init` container (needs `psql`); it receives the master credentials, so pin a mirror by digest |
| `enable_cognito`                                                                      | `false`                                   | Create the Cognito pool, client and `SHELF_OIDC_CLIENT_SECRET` (image does not read OIDC yet)                  |
| `admin_email`                                                                         | `admin@example.com`                       | Local admin login email (`SHELF_ADMIN_EMAIL`)                                                                  |
| `deletion_protection`                                                                 | `true`                                    | Database protection and final snapshot; `false` also empties the bucket on destroy                             |
| `github_app_id` / `github_app_private_key_secret_arn`                                 | `""`                                      | Server-wide GitHub App connection (both or none; see "Git connections")                                        |
| `github_api_url`                                                                      | `""`                                      | GitHub Enterprise Server API base; empty means github.com                                                      |
| `gitlab_token_secret_arn` / `gitlab_token_expires`                                    | `""`                                      | Server-wide GitLab connection (both or none)                                                                   |
| `gitlab_host`                                                                         | `""`                                      | GitLab base URL; empty means gitlab.com                                                                        |
| `remote_browser_endpoint_secret_arn` / `remote_browser_token_secret_arn`              | `""`                                      | Optional remote browser (secret references; the token is optional, the endpoint is not; see "Remote browsers") |
| `remote_browser_protocol` / `remote_browser_reach`                                    | `""`                                      | Declared, never inferred: `playwright` or `cdp`, and `loopback` or `url`. Required with the endpoint           |
| `remote_browser_engines`, `remote_browser_sessions`, `remote_browser_max_connections` | `""`, `0`, `0`                            | Engines (default `chromium`), parallel pages and most connections per copy; `0` leaves the image default       |
| `log_retention_days`                                                                  | `30`                                      | CloudWatch retention                                                                                           |
| `tags`                                                                                | `{}`                                      | Added to every taggable resource                                                                               |

## Outputs

`url`, `alb_dns_name`, `s3_bucket`, `db_endpoint`, `db_master_secret_arn`, `db_iam_user`,
`user_pool_id`, `app_client_id`, `cluster_name`, `service_name`, `admin_token_secret_arn`,
`admin_password_secret_arn`, `oidc_client_secret_arn`, `task_role_arn`, `task_role_policy_json` and
`execution_role_policy_json`. Secret outputs are ARNs (references), never values.

## Secrets

App secrets reach the task as ECS `secrets` references from Secrets Manager. No output carries a value.

- **`SHELF_SECRET`, `SHELF_ADMIN_PASSWORD`, `SHELF_ADMIN_TOKEN`** are generated (`random_password`). **Terraform
  state holds their values, so it must be encrypted** (for example an S3 backend with KMS and a
  restricted bucket policy) and readable by few people.
- **Sign-in.** The image turns sign-in on when `SHELF_ADMIN_PASSWORD` and `SHELF_SECRET` are both set, and the
  module always sets both, so the app never boots open. Read the password with
  `aws secretsmanager get-secret-value --secret-id "$(terraform output -raw admin_password_secret_arn)"`
  and sign in as `admin@example.com` (or `admin_email`). The load balancer admits only
  `allowed_cidr_blocks`.
- **Cognito** is off (`enable_cognito = false`): the image does not read OIDC yet, so the user pool,
  client and `SHELF_OIDC_CLIENT_SECRET` are not created.
- **`SHELF_OIDC_CLIENT_SECRET`** (with `enable_cognito`) is an operator step. Terraform writes `change-me` once and never
  overwrites it. Put the real value in and restart the service:

  ```sh
  aws secretsmanager put-secret-value --secret-id "$(terraform output -raw oidc_client_secret_arn)" --secret-string "<client secret>"
  aws ecs update-service --cluster "$(terraform output -raw cluster_name)" --service "$(terraform output -raw service_name)" --force-new-deployment
  ```

## Database: IAM authentication

The app connects with the `@storyshelf/db/postgres/rds-iam` preset: a short-lived token from its task role for
every new connection, verified against the Amazon RDS root certificates. There is no database
password for the app to read, and nothing to rotate.

**First boot needs no operator step.** RDS cannot grant `rds_iam`, so each task runs a `db-init`
container first (`database_init_image`: `postgres:16-alpine` from the ECR Public mirror, which has
`psql`, pinned by digest because it receives the master credentials). It logs in as the master user over TLS with the RDS-managed secret, then idempotently
creates the app user `shelf` (`db_iam_user`), grants it `rds_iam`, and gives it rights on the
database and the `public` schema. The app container starts only after `db-init` succeeds
(`dependsOn: SUCCESS`); its output is in the log group under the `db-init` stream prefix.

> **Unverified.** The first-boot database step (db-init: app user, rds_iam grant, backups) is checked by `terraform validate` only and has not yet run against a real RDS; tracked in #1096.

**Names differ by cloud:** on AWS the admin is `shelf_admin` and the app logs in as `shelf`; on GCP and Azure the admin is `shelf` and the app logs in as `shelf_app`, because renaming an existing admin would replace the server or the user that owns the tables.

The master user (`shelf_admin`) is separate and keeps its password, so operators can still log in
with the secret in `db_master_secret_arn` (from inside the VPC). Only `shelf` is IAM-only.

**Backups.** `database_backup_retention_days` (default 7, range 1-35) sets RDS automated backups
and point-in-time recovery. The database holds baselines and reviews.

With `existing_database_url_secret_arn` the module creates no database, adds no `rds-db:connect`
permission and passes the URL as `DATABASE_URL`. The network path to that database is yours.

## Task role policy

The task role is exactly the `task_role_policy_json` output, so a platform team can copy it into its
own stack. With the module's resources it reads:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "StorybookBucketObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<bucket>/*"
    },
    {
      "Sid": "StorybookBucketList",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::<bucket>"
    },
    {
      "Sid": "DatabaseIamLogin",
      "Effect": "Allow",
      "Action": "rds-db:connect",
      "Resource": "arn:aws:rds-db:<region>:<account>:dbuser:<db-resource-id>/shelf"
    }
  ]
}
```

The separate execution role (ECS itself, before the app starts) has
`AmazonECSTaskExecutionRolePolicy` plus `secretsmanager:GetSecretValue` on the app's secret ARNs
only (`execution_role_policy_json`). The `awslogs` driver writes the container's logs with the
execution role, so the task role has no logs permission.

## Capture, scaling and shutdown

- **Capture runs in the container** (the image ships Chromium). The module builds no browser
  service. To render in an existing remote browser as well, see "Remote browsers" below.
- **Scaling** is more identical copies between `min_instances` and `max_instances`, tracked on CPU.
  Per-copy limits (remote-browser connections, rate limits, the AI budget) are in the scaling docs.
- **Shutdown.** On a deploy ECS sends SIGTERM and the app drains running captures, then hands the
  rest back to the queue. The module sets `SHELF_SHUTDOWN_GRACE_SECONDS`, the ALB deregistration delay
  (equal to the grace) and the ECS `stopTimeout` (the grace plus 10 seconds; Fargate allows at most
  120). The image reads `SHELF_SHUTDOWN_GRACE_SECONDS` and bounds its drain by it, so the three agree.

## Domain and TLS

Without `domain_name` the plan fails unless `allow_http = true`, which serves plain HTTP (passwords and session cookies unencrypted): use it for throwaway stacks only. With a domain, the module creates a Route 53 zone,
an ACM certificate validated by DNS in it, an HTTPS listener (`ELBSecurityPolicy-TLS13-1-2-2021-06`:
TLS 1.2 and 1.3 only) and a 301 from port 80. The load balancer drops invalid header fields. ACM validates
only once the domain's name servers point at the new zone, so apply in two steps:

```sh
terraform apply -target='module.storyshelf.aws_route53_zone.main'
terraform state show 'module.storyshelf.aws_route53_zone.main[0]'   # copy the name_servers
# At your registrar (or the parent zone) create NS records for the domain with those servers.
terraform apply
```

## Existing VPC

Tag at least two public subnets in different zones `Tier = public` (ALB and tasks; they need a route
to an internet gateway) and at least two private subnets in different zones `Tier = private` (the
database subnet group).

## Git connections

Optional, for merge gates and pull-request comments without anyone pasting a key (ADR 0054). Create
the GitHub App's private key, or a GitLab group or project access token (`api` scope), as a
Secrets Manager secret yourself, then pass its reference. Terraform holds only the reference, so the key
and the token never enter configuration or state; the app reads them as
`SHELF_GITHUB_APP_PRIVATE_KEY` and `SHELF_GITLAB_TOKEN`. The execution role may read exactly these two ARNs, besides the app's own secrets. A half-set connection fails the plan,
and the image refuses to boot on one too, naming the variable and never its value. Rotating a key is
a new secret version and a new revision.

```sh
aws secretsmanager create-secret --name "<name>/GITHUB_APP_PRIVATE_KEY" --secret-string file://app.private-key.pem
```

## Remote browsers

Set `remote_browser_endpoint_secret_arn` to add one remote browser target (`chromium@remote`) beside the
bundled Chromium. The image reads it from `SHELF_REMOTE_BROWSER_*` and refuses to start when the
configuration is half set or malformed, naming the variable and never its value.

- The endpoint (`ws(s)://...`, which can carry a key) and the optional token are Secrets Manager secrets
  you create outside Terraform, so their values never enter configuration or state. They reach the
  container as secret references, and the execution role may read exactly those secrets.
- `remote_browser_protocol` (`playwright` or `cdp`) and `remote_browser_reach` (`loopback` or `url`) are
  declared, never inferred, and required with the endpoint. `reach = "url"` makes the browser open a
  signed Storybook URL on the public origin; the module always sets `SHELF_SECRET` and
  `SHELF_PUBLIC_BASE_URL`, so it is available. `loopback` needs the `playwright` protocol.
- `remote_browser_max_connections` caps connections per copy (`SHELF_REMOTE_BROWSER_MAX_CONNECTIONS`).
  The plan's own limit is shared by every copy, so divide it by `max_instances`.
- Projects opt in to the target under Settings, Capture. See the remote browsers guide on the website.

## Image contract

The module passes these to the image. Every variable below is read by the image except those
marked _not read_, which the image does not use yet.

| Variable                                                                                         | Source                                | Status   |
| ------------------------------------------------------------------------------------------------ | ------------------------------------- | -------- |
| `SHELF_S3_BUCKET`, `AWS_REGION`, `SHELF_PUBLIC_BASE_URL`, `SHELF_TRUST_PROXY`                    | module                                | read     |
| `SHELF_SHUTDOWN_GRACE_SECONDS`                                                                   | `shutdown_grace_seconds`              | read     |
| `SHELF_SECRET`, `SHELF_ADMIN_TOKEN`, `SHELF_ADMIN_PASSWORD`                                      | Secrets Manager                       | read     |
| `SHELF_ADMIN_EMAIL`                                                                              | `admin_email`                         | read     |
| `DATABASE_URL`                                                                                   | `existing_database_url_secret_arn`    | read     |
| `SHELF_DATABASE_IAM_HOST`, `_USER`, `_NAME`, `_REGION`                                           | the created RDS instance              | read     |
| `SHELF_DATABASE_POOL_MAX`                                                                        | `database_pool_size`                  | read     |
| `SHELF_GITHUB_APP_ID`, `SHELF_GITHUB_API_URL`, `SHELF_GITLAB_HOST`, `SHELF_GITLAB_TOKEN_EXPIRES` | git inputs (optional)                 | read     |
| `SHELF_GITHUB_APP_PRIVATE_KEY`, `SHELF_GITLAB_TOKEN`                                             | Secrets Manager references (optional) | read     |
| `SHELF_REMOTE_BROWSER_ENDPOINT`, `SHELF_REMOTE_BROWSER_TOKEN`                                    | Secrets Manager references (optional) | read     |
| `SHELF_REMOTE_BROWSER_PROTOCOL`, `_REACH`, `_ENGINES`, `_SESSIONS`, `_MAX_CONNECTIONS`           | `remote_browser_*` inputs (optional)  | read     |
| `SHELF_OIDC_CLIENT_SECRET` (with `enable_cognito`)                                               | Secrets Manager                       | not read |

The image reads the `SHELF_DATABASE_IAM_*` variables through the `@storyshelf/db/postgres/rds-iam` preset. It refuses
to start when they are set but incomplete, and never falls back to SQLite. Cognito sign-in is not
wired: the image does not read the OIDC settings yet, so sign in with `SHELF_ADMIN_PASSWORD`.

## Checks

CI runs `terraform fmt -check`, `terraform validate` and `tflint` on every module under
`deploy/terraform`. The nightly live-cloud workflow applies `examples/minimal` with the current
release image, smoke-tests it and destroys it.
