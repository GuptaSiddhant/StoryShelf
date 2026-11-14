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

| Part     | Resources                                                                      |
| -------- | ------------------------------------------------------------------------------ |
| Network  | VPC with 2 public and 2 private subnets (or your own `vpc_id`), no NAT gateway |
| Compute  | ECS cluster, one Fargate service of identical copies, ALB, CPU autoscaling     |
| Database | RDS Postgres in private subnets, IAM authentication on (or your own URL)       |
| Storage  | S3 bucket: private, versioned, encrypted                                       |
| Identity | Cognito user pool, app client, optional SAML federation                        |
| Secrets  | Secrets Manager: `SECRET`, `ADMIN_TOKEN`, `OIDC_CLIENT_SECRET`                 |
| DNS      | With `domain_name`: Route 53 zone, ACM certificate, HTTPS listener             |
| Logs     | CloudWatch log group                                                           |

Tasks run in the public subnets with a public IP (to pull the image and reach AWS APIs) and their
security group admits only the ALB. The database is reachable from the task security group only.

## Inputs

| Name                                 | Default                            | Meaning                                                                            |
| ------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------- |
| `name`                               | required                           | Name prefix, 2-20 characters                                                       |
| `image_version`                      | required                           | Release version of the image (no `v`)                                              |
| `region`                             | `us-east-1`                        | Must match the provider's region                                                   |
| `image_repository`                   | `ghcr.io/guptasiddhant/storyshelf` | Registry path, for a mirror                                                        |
| `vpc_id`                             | `""`                               | Existing VPC; subnets are found by their `Tier` tag (`public`, `private`)          |
| `allowed_cidr_blocks`                | required                           | IPv4 ranges that may reach the load balancer; `["0.0.0.0/0"]` publishes the app    |
| `allow_http`                         | `false`                            | Plain HTTP without a domain; the plan fails otherwise                              |
| `domain_name`                        | `""`                               | Enables HTTPS (see "Domain and TLS")                                               |
| `saml_metadata_url`                  | `""`                               | Cognito SAML federation                                                            |
| `task_cpu` / `task_memory`           | `2048` / `4096`                    | Capture renders in the container: do not go much lower                             |
| `min_instances` / `max_instances`    | `1` / `1`                          | Identical copies; every copy serves and consumes the queue (ADR 0006)              |
| `database_pool_size`                 | `10`                               | Connections per copy: `max_instances` x this must fit the database's limit         |
| `shutdown_grace_seconds`             | `30`                               | See "Shutdown"                                                                     |
| `existing_database_url_secret_arn`   | `""`                               | A Postgres URL in Secrets Manager; no database is created                          |
| `database_instance_class`            | `db.t4g.micro`                     | Created database only                                                              |
| `database_allocated_storage`         | `20`                               | GiB, created database only                                                         |
| `deletion_protection`                | `true`                             | Database protection and final snapshot; `false` also empties the bucket on destroy |
| `remote_browser_endpoint_secret_arn` | `""`                               | Optional remote browser (secret reference)                                         |
| `remote_browser_token_secret_arn`    | `""`                               | Optional remote browser token (secret reference)                                   |
| `log_retention_days`                 | `30`                               | CloudWatch retention                                                               |
| `tags`                               | `{}`                               | Added to every taggable resource                                                   |

## Outputs

`url`, `alb_dns_name`, `s3_bucket`, `db_endpoint`, `db_master_secret_arn`, `db_iam_user`,
`user_pool_id`, `app_client_id`, `cluster_name`, `service_name`, `task_role_arn`,
`task_role_policy_json` and `execution_role_policy_json`. Secret outputs are ARNs (references),
never values.

## Secrets

App secrets reach the task as ECS `secrets` references from Secrets Manager. No output carries a value.

- **`SECRET`, `AUTH_PASSWORD`, `ADMIN_TOKEN`** are generated (`random_password`). **Terraform
  state holds their values, so it must be encrypted** (for example an S3 backend with KMS and a
  restricted bucket policy) and readable by few people.
- **Sign-in.** The image turns sign-in on when `AUTH_PASSWORD` and `SECRET` are both set, and the
  module always sets both, so the app never boots open. Read the password with
  `aws secretsmanager get-secret-value --secret-id "$(terraform output -raw auth_password_secret_arn)"`
  and sign in as `admin@example.com` (or `AUTH_EMAIL`). The load balancer admits only
  `allowed_cidr_blocks`.
- **Cognito.** The user pool and `OIDC_CLIENT_SECRET` are created and passed to the task, but the
  image does not read them yet: OIDC sign-in is not wired.
- **`OIDC_CLIENT_SECRET`** is an operator step. Terraform writes `change-me` once and never
  overwrites it. Put the real value in and restart the service:

  ```sh
  aws secretsmanager put-secret-value --secret-id "$(terraform output -raw oidc_client_secret_arn)" --secret-string "<client secret>"
  aws ecs update-service --cluster "$(terraform output -raw cluster_name)" --service "$(terraform output -raw service_name)" --force-new-deployment
  ```

## Database: IAM authentication

The app connects with the `db-postgres/rds-iam` preset: a short-lived token from its task role for
every new connection, verified against the Amazon RDS root certificates. There is no database
password for the app to read, and nothing to rotate.

**One operator step (Terraform cannot do it: the database has no public route).** RDS cannot grant `rds_iam` to a user. Once, connect with the master
secret (`db_master_secret_arn`) from inside the VPC and run:

```sql
GRANT rds_iam TO shelf;
```

`shelf` is the master user the module creates (`db_iam_user`); with `rds_iam` granted it logs in
with a token (the master password keeps working for you). Prefer a separate application user? Create
it, grant `rds_iam` and the schema rights it needs, and change `local.database_user`.

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
    },
    {
      "Sid": "AppLogs",
      "Effect": "Allow",
      "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "arn:aws:logs:<region>:<account>:log-group:/ecs/<name>-app:*"
    }
  ]
}
```

The separate execution role (ECS itself, before the app starts) has
`AmazonECSTaskExecutionRolePolicy` plus `secretsmanager:GetSecretValue` on the app's secret ARNs
only (`execution_role_policy_json`).

## Capture, scaling and shutdown

- **Capture runs in the container** (the image ships Chromium). For a remote browser, put its
  endpoint and token in Secrets Manager and pass the two ARNs; they become `REMOTE_BROWSER_ENDPOINT`
  and `REMOTE_BROWSER_TOKEN`. The module builds no browser service.
- **Scaling** is more identical copies between `min_instances` and `max_instances`, tracked on CPU.
  Per-copy limits (remote-browser connections, rate limits, the AI budget) are in the scaling docs.
- **Shutdown.** On a deploy ECS sends SIGTERM and the app drains running captures for
  `shutdown_grace_seconds` (`SHUTDOWN_GRACE_SECONDS`), then hands the rest back to the queue. The
  ALB deregistration delay equals the grace and the ECS `stopTimeout` is the grace plus 10 seconds
  (Fargate allows at most 120), so the task is never killed mid-drain.

## Domain and TLS

Without `domain_name` the plan fails unless `allow_http = true`, which serves plain HTTP (passwords and session cookies unencrypted): use it for throwaway stacks only. With a domain, the module creates a Route 53 zone,
an ACM certificate validated by DNS in it, an HTTPS listener and a 301 from port 80. ACM validates
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

## Image contract

The module passes these to the image. Every variable below is read by the image except the two
marked _not read_, which the image does not use yet.

| Variable                                                     | Source                             | Status   |
| ------------------------------------------------------------ | ---------------------------------- | -------- |
| `AWS_BUCKET`, `AWS_REGION`, `PUBLIC_BASE_URL`, `TRUST_PROXY` | module                             | read     |
| `SHUTDOWN_GRACE_SECONDS`                                     | `shutdown_grace_seconds`           | read     |
| `SECRET`, `ADMIN_TOKEN`, `AUTH_PASSWORD`                     | Secrets Manager                    | read     |
| `DATABASE_URL`                                               | `existing_database_url_secret_arn` | read     |
| `DATABASE_IAM_HOST`, `_USER`, `_NAME`, `_REGION`             | the created RDS instance           | read     |
| `DATABASE_POOL_MAX`                                          | `database_pool_size`               | read     |
| `OIDC_CLIENT_SECRET` (Cognito)                               | Secrets Manager                    | not read |
| `REMOTE_BROWSER_ENDPOINT`, `REMOTE_BROWSER_TOKEN`            | secret references                  | not read |

The image reads the `DATABASE_IAM_*` variables through the `db-postgres/rds-iam` preset. It refuses
to start when they are set but incomplete, and never falls back to SQLite. Cognito sign-in is not
wired: the image does not read the OIDC settings yet, so sign in with `AUTH_PASSWORD`.

## Checks

CI runs `terraform fmt -check`, `terraform validate` and `tflint` on every module under
`deploy/terraform`. The nightly live-cloud workflow applies `examples/minimal` with the current
release image, smoke-tests it and destroys it.
