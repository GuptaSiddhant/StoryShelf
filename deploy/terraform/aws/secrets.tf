# Secrets Manager holds every app secret. The task receives them as ECS `secrets` references; no
# module output carries a value.
resource "aws_secretsmanager_secret" "shelf_secret" {
  name_prefix = "${var.name}/SHELF_SECRET-"

  tags = var.tags
}

resource "aws_secretsmanager_secret" "oidc_client_secret" {
  count       = var.enable_cognito ? 1 : 0
  name_prefix = "${var.name}/SHELF_OIDC_CLIENT_SECRET-"

  tags = var.tags
}

# The local admin login: the image enables sign-in when SHELF_ADMIN_PASSWORD and SHELF_SECRET are both set, so
# the stack never boots open. Sign in as SHELF_ADMIN_EMAIL (default admin@example.com).
resource "aws_secretsmanager_secret" "auth_password" {
  name_prefix = "${var.name}/SHELF_ADMIN_PASSWORD-"

  tags = var.tags
}

resource "aws_secretsmanager_secret" "admin_token" {
  name_prefix = "${var.name}/SHELF_ADMIN_TOKEN-"

  tags = var.tags
}

# SHELF_SECRET, SHELF_ADMIN_PASSWORD and SHELF_ADMIN_TOKEN are generated, so their values also sit in the Terraform state: keep the
# state in an encrypted backend with restricted access.
resource "random_password" "shelf_secret" {
  length  = 48
  special = false
}

resource "random_password" "auth_password" {
  length  = 32
  special = false
}

resource "random_password" "admin_token" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret_version" "shelf_secret" {
  secret_id     = aws_secretsmanager_secret.shelf_secret.id
  secret_string = random_password.shelf_secret.result
}

resource "aws_secretsmanager_secret_version" "auth_password" {
  secret_id     = aws_secretsmanager_secret.auth_password.id
  secret_string = random_password.auth_password.result
}

resource "aws_secretsmanager_secret_version" "admin_token" {
  secret_id     = aws_secretsmanager_secret.admin_token.id
  secret_string = random_password.admin_token.result
}

# Operator-provided: a placeholder is written once and then left alone.
resource "aws_secretsmanager_secret_version" "oidc_client_secret" {
  count         = var.enable_cognito ? 1 : 0
  secret_id     = aws_secretsmanager_secret.oidc_client_secret[0].id
  secret_string = "change-me"

  lifecycle {
    ignore_changes = [secret_string]
  }
}
