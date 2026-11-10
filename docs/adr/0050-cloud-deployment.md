# ADR 0050: Cloud Deployment Without Cloud Packages

## Status

Accepted (owner, 2026-11-10; proposed by the architect). The work lands on epic branch
`epic/889-cloud-deploy` (#889). The Terraform generators in the developer CLI
stay until that epic merges.

## Context

StoryShelf runs on AWS, GCP and Azure today through three kinds of cloud-specific code:

- **Presets inside adapters.** Each cloud's database flavour is a subpath of the database adapter:
  - `db-postgres/neon` and `db-postgres/vercel`;
  - `db-mysql/planetscale` and `db-mysql/tidb`;
  - `db-sqlite/d1` and `db-sqlite/turso`.

  Storage has one adapter per cloud, and `storage-s3` also covers R2 and MinIO.

- **Terraform generators in the developer CLI.** `storyshelf server terraform-{aws,gcp,azure}` is
  about 3,150 lines of TypeScript that print Terraform:
  - **AWS:** ECS Fargate, ALB, RDS Postgres, Cognito, Secrets Manager, CloudWatch;
  - **GCP:** Cloud Run, Cloud SQL, GCS;
  - **Azure:** Container Apps, Postgres, Blob storage.

  Each stack builds its own image.

- **Serverless detection.** `assertServerless` refuses a runner on Lambda and warns on Vercel and
  Netlify.

The generators have three problems:

1. **Drift.** Generated code belongs to the customer the moment it is written, so our fixes never
   reach existing installs.
2. **Wrong owner.** Every CI install of the developer CLI ships infrastructure code.
3. **A gap for platform teams.** Companies that run all their infrastructure on one cloud have
   their own conventions, account structure and IAM reviews. They need a module they can pin and
   upgrade, its exact permissions, and an image to point at, not a one-off printout.

One runtime gap remains on AWS. The AWS stack builds `DATABASE_URL` from an RDS-managed secret once at
startup, so a rotated password breaks the connection until the app restarts.

The owner asked whether a company built entirely on AWS would benefit from an AWS package
(2026-11-10).

## Decision

### 1. No per-cloud packages

There is no `@storyshelf/aws`, `@storyshelf/gcp` or `@storyshelf/azure`. Cloud-specific code goes
where its concern lives:

| Kind of code                             | Form                                                 |
| ---------------------------------------- | ---------------------------------------------------- |
| Runs inside the app (database, email, …) | A preset (a subpath or option) of the owning package |
| Builds the account around the app        | A versioned Terraform module per cloud (decision 3)  |
| Explains choices and trade-offs          | One deployment page per cloud on the website         |

A preset that needs a cloud SDK takes it as an **optional peer** of the owning package, loaded only
when the preset is used, as the existing database presets do.

### 2. Runtime presets

- **`db-postgres/rds-iam`:** connects to RDS or Aurora with short-lived IAM authentication tokens,
  renewed for each new connection. It uses `@aws-sdk/rds-signer` as an optional peer, so the standard
  AWS credential chain (ECS task role, instance role, web identity) applies. With IAM auth there is
  no database password to rotate. The AWS module (decision 3) uses it and drops the RDS-managed secret
  from the app.
- **An `ses` email preset** in core's email integration (ADR 0049): SMTP settings for SES per region,
  with credentials from the environment. It is configuration only, with no SDK. An SES API preset
  follows only on demand.
- **GCP Cloud SQL and Azure Database for PostgreSQL** get the same IAM or Entra ID token presets
  (`db-postgres/cloud-sql-iam`, `db-postgres/azure-entra`) later, on the same pattern, when a user
  asks.

Every preset keeps the adapter's contract tests. No preset changes behaviour for installs that don't
use it.

### 3. Terraform modules, not generators

- **Location:** `deploy/terraform/{aws,gcp,azure}` holds plain Terraform modules. Each has:
  - documented inputs and outputs;
  - a `versions.tf` that pins the providers;
  - one `examples/minimal` folder.
- **Image:** a module deploys the published image (`ghcr.io/guptasiddhant/storyshelf`, #887) at a
  version given as an input. It never builds an image.
- **Versioning:** modules are addressed by release tag through a git source, e.g.
  `git::https://github.com/GuptaSiddhant/StoryShelf.git//deploy/terraform/aws?ref=v0.12.0`.
  - The Terraform Registry needs a repository per module, so it is not used.
  - Each release also attaches a tarball of `deploy/terraform/`.
- **Least privilege:**
  - each module outputs, and documents, the exact IAM policy or roles the app gets;
  - secrets come from the cloud's secret store as references, never as plain outputs;
  - databases are reachable only on private networking.
- **Checks:**
  - CI runs `terraform fmt -check`, `terraform validate` and `tflint` on every change under
    `deploy/`;
  - the existing nightly live-cloud workflows apply each module and run the smoke test against it.
- **What they deploy:** the full product (the app plus capture) on one container service per cloud,
  with these managed services:

  | Cloud | Compute        | Database       | Storage | Sign-in |
  | ----- | -------------- | -------------- | ------- | ------- |
  | AWS   | ECS Fargate    | RDS Postgres   | S3      | Cognito |
  | GCP   | Cloud Run      | Cloud SQL      | GCS     | —       |
  | Azure | Container Apps | Azure Postgres | Blob    | —       |

### 4. The CLI only starts a stack

- `storyshelf server init --cloud aws|gcp|azure` writes:
  - a `main.tf` that uses the module at the CLI's own version;
  - a `terraform.tfvars` with the answers to its prompts.
- The `terraform-*` generators and their snapshot tests are removed.
- The command moves to `@storyshelf/server` with #367.
- For existing generated stacks, a migration guide gives `moved` blocks that map their resources to
  the module's addresses.

### 5. Officially supported targets

These are documented, and tested in CI or nightly:

- **Containers:** `docker run` or Compose, Fly, AWS ECS Fargate, GCP Cloud Run and Azure Container
  Apps. This is the full product.
- **Serverless without capture:** Vercel, Netlify and AWS Lambda, as today (`assertServerless`).

Kubernetes (a Helm chart) and Cloudflare Workers (#396) are not supported until a user asks and, for
Workers, until #396 reports its blockers.

## Consequences

- A company built on one cloud uses the generic adapters (with that cloud's preset) or the published
  image. Its platform team either:
  - pins our module and upgrades it by changing the version; or
  - copies the module's IAM policy and environment contract into its own stack.
- Fixes to the stacks reach every install that pins the module, instead of only new generations.
- The developer CLI loses about 3,150 lines and its Terraform snapshot tests.
- Live-cloud nightly runs now test the same modules customers use.
- A CDK construct for AWS is not offered. It can follow if CDK-first users ask; it would wrap the
  same image and IAM policy.

## Alternatives considered

- **A kit package per cloud** (preset config, runtime entry and IaC together). Rejected: the runtime
  parts already fit inside the owning adapters, and infrastructure is not npm-shaped. It would add
  about five packages right after ADR 0049 removed five.
- **Keep the TypeScript generators, moved to `@storyshelf/server`.** Rejected: generated code still
  drifts after the first run.
- **Docs recipes only.** Rejected: every customer would re-type the same stack untested.
- **Terraform Registry publication.** Rejected for now: the registry needs one repository per module.
  The git source pinned to a tag gives the same versioning.
