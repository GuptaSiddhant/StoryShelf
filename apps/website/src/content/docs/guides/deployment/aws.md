---
title: AWS deployment
description: Deploy StoryShelf on AWS with ECS, S3, SQS, Postgres, and Cognito via Terraform.
---

For AWS-only enterprise deployments, `storyshelf server init` offers an `aws` deploy target that pins the full reference stack — ECS Fargate app + worker, S3, SQS + DLQ, Postgres (RDS default, Aurora DSQL option), Cognito, Secrets Manager, CloudWatch, and an optional Route 53 + ACM front door — and writes it as Terraform under `terraform/`.

## Scaffold

```bash
storyshelf server init
# ? Deploy target? AWS (ECS + S3 + SQS + Postgres + Cognito)
# ? AWS region? us-east-1
# ? Postgres engine? RDS / Aurora DSQL
# ? Public domain for the ALB? (empty leaves it HTTP-only)
# ? SAML metadata URL for Cognito federation? (empty skips it)
```

## Apply

Terraform is never auto-applied — review explicitly:

```bash
cd my-server
terraform -chdir=terraform init
terraform -chdir=terraform plan -out=tfplan   # review before applying
terraform -chdir=terraform apply tfplan       # or: npm run infra:apply
```

## Wiring outputs

Wire the outputs into env (`terraform output -json` / `npm run infra:outputs`): `S3_BUCKET` + `AWS_REGION`, `QUEUE_URL`, `DATABASE_URL` (`?sslmode=require`), `COGNITO_REGION` / `COGNITO_USER_POOL_ID` / `OIDC_*`, `SECRET`. Output keys (`alb_dns_name`, `s3_bucket`, `queue_url`, `db_endpoint`, `user_pool_id`, `app_client_id`) are a stable contract parsed by CI — they never change.

Credentials come from IAM task roles — never check access keys into env files. Corporate SSO federates through Cognito SAML (Entra/Okta via `samlMetadataUrl`); `adminGroups: ["shelf-admins"]` maps the Cognito group to site admin.

Pair with [@storyshelf/storage-s3](/packages/storage-s3/) and [@storyshelf/queue-sqs](/packages/queue-sqs/) — the scaffold already wires them.

## Related

- [Deployment overview](/guides/deployment/) — Docker Compose, subdomains, auth, other clouds
