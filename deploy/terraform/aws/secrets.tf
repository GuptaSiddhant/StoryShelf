# Secrets Manager holds every app secret. The task receives them as ECS `secrets` references; no
# module output carries a value.
resource "aws_secretsmanager_secret" "shelf_secret" {
  name_prefix = "${var.name}/SECRET-"

  tags = var.tags
}

resource "aws_secretsmanager_secret" "oidc_client_secret" {
  name_prefix = "${var.name}/OIDC_CLIENT_SECRET-"

  tags = var.tags
}

resource "aws_secretsmanager_secret" "admin_token" {
  name_prefix = "${var.name}/ADMIN_TOKEN-"

  tags = var.tags
}

# SECRET and ADMIN_TOKEN are generated, so their values also sit in the Terraform state: keep the
# state in an encrypted backend with restricted access.
resource "random_password" "shelf_secret" {
  length  = 48
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

resource "aws_secretsmanager_secret_version" "admin_token" {
  secret_id     = aws_secretsmanager_secret.admin_token.id
  secret_string = random_password.admin_token.result
}

# Operator-provided: a placeholder is written once and then left alone.
resource "aws_secretsmanager_secret_version" "oidc_client_secret" {
  secret_id     = aws_secretsmanager_secret.oidc_client_secret.id
  secret_string = "change-me"

  lifecycle {
    ignore_changes = [secret_string]
  }
}
