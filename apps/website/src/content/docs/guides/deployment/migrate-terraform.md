---
title: Migrate a generated Terraform stack
description: Move a stack written by an older `storyshelf server init` onto the versioned Terraform modules, with moved blocks and the switch to IAM database authentication.
---

Older CLI versions printed a Terraform stack into your project (`terraform/*.tf`), and `storyshelf server terraform-aws|gcp|azure` printed the same. Those generators are gone. Each cloud now has a versioned module under `deploy/terraform/<cloud>` in the StoryShelf repository, and `storyshelf server init --cloud <aws|gcp|azure>` writes a `main.tf` that pins it at the CLI's own version. See [ADR 0050](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0050-cloud-deployment.md).

A stack you already applied keeps working; nothing here is urgent. Move when you want fixes to reach it by changing a version.

## Before you start

1. Back up the Terraform state (`terraform state pull > backup.tfstate`).
2. Pin the stack to a release: replace the generated files with the stub from `npx create-storyshelf --cloud <cloud>`, keeping your old `terraform/` directory aside until the plan is clean.
3. Reuse the old `name`, region, domain and VPC settings, so resource names do not change.
4. Add the `moved` blocks for your cloud below to `main.tf`, then run `terraform plan`. A clean migration shows only changes you expect, and no resource it would destroy and create that holds data (the database, the bucket, the secrets).

## AWS

The module keeps the resource names of the generated stack, so most blocks move one-to-one under `module.storyshelf`. Resources the module creates conditionally take an index.

```hcl
# Terraform has no loop for `moved`: write one block per resource. Resources that exist in both
# keep their names and move under the module.

moved {
  from = aws_s3_bucket.storybook
  to   = module.storyshelf.aws_s3_bucket.storybook
}
moved {
  from = aws_s3_bucket_versioning.storybook
  to   = module.storyshelf.aws_s3_bucket_versioning.storybook
}
moved {
  from = aws_s3_bucket_server_side_encryption_configuration.storybook
  to   = module.storyshelf.aws_s3_bucket_server_side_encryption_configuration.storybook
}
moved {
  from = aws_s3_bucket_public_access_block.storybook
  to   = module.storyshelf.aws_s3_bucket_public_access_block.storybook
}
moved {
  from = aws_s3_bucket_lifecycle_configuration.storybook
  to   = module.storyshelf.aws_s3_bucket_lifecycle_configuration.storybook
}

# The database and its subnet group and security group are now counted.
moved {
  from = aws_db_instance.main
  to   = module.storyshelf.aws_db_instance.main[0]
}
moved {
  from = aws_db_subnet_group.main
  to   = module.storyshelf.aws_db_subnet_group.main[0]
}
moved {
  from = aws_security_group.db
  to   = module.storyshelf.aws_security_group.db[0]
}

# The ECS security group is now called "app".
moved {
  from = aws_security_group.ecs
  to   = module.storyshelf.aws_security_group.app
}
moved {
  from = aws_security_group.alb
  to   = module.storyshelf.aws_security_group.alb
}

moved {
  from = aws_ecs_cluster.main
  to   = module.storyshelf.aws_ecs_cluster.main
}
moved {
  from = aws_ecs_service.app
  to   = module.storyshelf.aws_ecs_service.app
}
moved {
  from = aws_ecs_task_definition.app
  to   = module.storyshelf.aws_ecs_task_definition.app
}
moved {
  from = aws_cloudwatch_log_group.app
  to   = module.storyshelf.aws_cloudwatch_log_group.app
}
moved {
  from = aws_lb.main
  to   = module.storyshelf.aws_lb.main
}
moved {
  from = aws_lb_target_group.app
  to   = module.storyshelf.aws_lb_target_group.app
}

moved {
  from = aws_iam_role.execution
  to   = module.storyshelf.aws_iam_role.execution
}
moved {
  from = aws_iam_role.task
  to   = module.storyshelf.aws_iam_role.task
}
moved {
  from = aws_iam_role_policy_attachment.execution
  to   = module.storyshelf.aws_iam_role_policy_attachment.execution
}
moved {
  from = aws_iam_role_policy.execution_secrets
  to   = module.storyshelf.aws_iam_role_policy.execution_secrets
}
# `task_secrets` and `task_storage` are merged into one `task` policy: Terraform destroys the two
# old ones and creates the new one, which is expected.

moved {
  from = aws_secretsmanager_secret.shelf_secret
  to   = module.storyshelf.aws_secretsmanager_secret.shelf_secret
}
moved {
  from = aws_secretsmanager_secret_version.shelf_secret
  to   = module.storyshelf.aws_secretsmanager_secret_version.shelf_secret
}
moved {
  from = aws_secretsmanager_secret.admin_token
  to   = module.storyshelf.aws_secretsmanager_secret.admin_token
}
moved {
  from = aws_secretsmanager_secret_version.admin_token
  to   = module.storyshelf.aws_secretsmanager_secret_version.admin_token
}
moved {
  from = aws_secretsmanager_secret.oidc_client_secret
  to   = module.storyshelf.aws_secretsmanager_secret.oidc_client_secret
}
moved {
  from = aws_secretsmanager_secret_version.oidc_client_secret
  to   = module.storyshelf.aws_secretsmanager_secret_version.oidc_client_secret
}
moved {
  from = random_password.shelf_secret
  to   = module.storyshelf.random_password.shelf_secret
}
moved {
  from = random_password.admin_token
  to   = module.storyshelf.random_password.admin_token
}

moved {
  from = aws_cognito_user_pool.main
  to   = module.storyshelf.aws_cognito_user_pool.main
}
moved {
  from = aws_cognito_user_pool_client.shelf
  to   = module.storyshelf.aws_cognito_user_pool_client.shelf
}
moved {
  from = aws_cognito_user_group.admins
  to   = module.storyshelf.aws_cognito_user_group.admins
}
```

If you created the network (no `vpc_id`), also move the counted resources, which keep their indexes:

```hcl
moved {
  from = aws_vpc.main
  to   = module.storyshelf.aws_vpc.main
}
moved {
  from = aws_subnet.public
  to   = module.storyshelf.aws_subnet.public
}
moved {
  from = aws_subnet.private
  to   = module.storyshelf.aws_subnet.private
}
moved {
  from = aws_internet_gateway.main
  to   = module.storyshelf.aws_internet_gateway.main
}
moved {
  from = aws_route_table.public
  to   = module.storyshelf.aws_route_table.public
}
moved {
  from = aws_route_table_association.public
  to   = module.storyshelf.aws_route_table_association.public
}
moved {
  from = aws_vpc_endpoint.s3
  to   = module.storyshelf.aws_vpc_endpoint.s3
}
```

If you set a `domain_name`, move the DNS and certificate resources in the same way (`aws_route53_zone.main`, `aws_acm_certificate.main`, `aws_acm_certificate_validation.main`, `aws_route53_record.app` and `aws_lb_listener.https` keep their indexes; `aws_route53_record.cert_validation` keeps its keys). If you set `saml_metadata_url`, move `aws_cognito_identity_provider.saml` too. The HTTP listener and the security group rules are replaced by the module's; Terraform recreates them without data loss.

Two changes in the module are deliberate and show in the plan:

- **`allowed_cidr_blocks` is required.** The old stack opened the load balancer to the world. Set the ranges you want, or `["0.0.0.0/0"]` to keep the old behaviour.
- **No plain HTTP without a domain** unless you set `allow_http = true`, because passwords and session cookies would cross the network unencrypted.

### Switch the database to `rds-iam`

The old stack read the RDS-managed master password from Secrets Manager at startup and built `DATABASE_URL`, so a rotated password broke the connection until a restart. The module connects with short-lived IAM tokens instead (`db-postgres/rds-iam`), so no database password reaches the app.

The module creates the instance with IAM authentication on (`iam_database_authentication_enabled`), and the migration applies that in place, with no restart of the app's data.

1. Apply the migrated stack. The task role gets `rds-db:connect` for the database user the module names in its `db_iam_user` output (`shelf`), and the container starts with `SHELF_DATABASE_IAM_HOST`, `SHELF_DATABASE_IAM_USER`, `SHELF_DATABASE_IAM_NAME` and `SHELF_DATABASE_IAM_REGION` instead of `DATABASE_URL`.
2. Once, from inside the VPC, connect with the master secret (`db_master_secret_arn`) and run:

   ```sql
   GRANT rds_iam TO shelf;
   ```

   **Run this last.** After the grant `shelf` can log in only with an IAM token; its password, including the master secret, stops working. To keep a usable password login for administration, create a separate application user, grant it `rds_iam` and the schema rights it needs, and set the module's database user to it.

3. Let the ECS service roll and check `/api/v1/health`.

An existing database you manage yourself can stay as it is: set `existing_database_url_secret_arn` to a secret that holds the connection URL.

## GCP and Azure

The GCP and Azure modules follow the AWS pattern: the generated resource addresses move under `module.storyshelf` with a `moved` block each, and `terraform plan` shows what differs. The exact address list is published with each module (its README, under "Migrating a generated stack") when the module lands; until then, keep the generated stack.

## After the move

- `terraform plan` shows no changes (or only the ones you accept), then `terraform apply`.
- Delete the old `terraform/` directory and its `infra:*` npm scripts. Upgrade by changing the `?ref=` in `main.tf` and the `image_version`, then reading the plan.
- The module's outputs (`url`, `s3_bucket`, `db_endpoint`, `task_role_policy_json`, …) replace the old output keys. Read its README for the full list.
