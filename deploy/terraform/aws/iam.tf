data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

locals {
  # Secrets the task receives as ECS `secrets` references (read by the execution role).
  app_secret_arns = compact([
    aws_secretsmanager_secret.shelf_secret.arn,
    aws_secretsmanager_secret.oidc_client_secret.arn,
    aws_secretsmanager_secret.admin_token.arn,
    var.existing_database_url_secret_arn,
    var.remote_browser_endpoint_secret_arn,
    var.remote_browser_token_secret_arn,
  ])
}

# Execution role: ECS itself, before the app starts. It pulls the image, writes the container's
# logs and resolves the secret references.
resource "aws_iam_role" "execution" {
  name               = "${var.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    sid       = "ReadAppSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = local.app_secret_arns
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-app-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# Task role: the app's own permissions, and nothing else. The policy below is exactly what the
# `task_role_policy_json` output prints, so a platform team can copy it into its own stack.
data "aws_iam_policy_document" "task" {
  statement {
    sid       = "StorybookBucketObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.storybook.arn}/*"]
  }

  statement {
    sid       = "StorybookBucketList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.storybook.arn]
  }

  dynamic "statement" {
    for_each = local.create_database ? [1] : []

    content {
      sid     = "DatabaseIamLogin"
      actions = ["rds-db:connect"]
      resources = [
        "arn:aws:rds-db:${var.region}:${data.aws_caller_identity.current.account_id}:dbuser:${aws_db_instance.main[0].resource_id}/${local.database_user}",
      ]
    }
  }

  statement {
    sid       = "AppLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.app.arn}:*"]
  }
}

resource "aws_iam_role" "task" {
  name               = "${var.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json

  tags = var.tags
}

resource "aws_iam_role_policy" "task" {
  name   = "app"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}
