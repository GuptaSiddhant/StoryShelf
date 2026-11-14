# RDS Postgres in the private subnets. The app connects with the rds-iam preset: a short-lived IAM
# token per connection, so there is no database password for the app to read or rotate. RDS still
# keeps a master password in its own Secrets Manager secret (never in Terraform state); only an
# operator needs it, once, to create the IAM database user (see the README).
locals {
  create_database = var.existing_database_url_secret_arn == ""
  database_user   = "shelf"
  database_name   = "shelf"
}

resource "aws_db_subnet_group" "main" {
  count      = local.create_database ? 1 : 0
  name       = "${var.name}-db"
  subnet_ids = local.private_subnet_ids

  tags = var.tags
}

resource "aws_db_instance" "main" {
  count                               = local.create_database ? 1 : 0
  identifier                          = "${var.name}-db"
  engine                              = "postgres"
  engine_version                      = "16"
  instance_class                      = var.database_instance_class
  allocated_storage                   = var.database_allocated_storage
  storage_encrypted                   = true
  db_name                             = local.database_name
  username                            = local.database_user
  manage_master_user_password         = true
  iam_database_authentication_enabled = true
  db_subnet_group_name                = aws_db_subnet_group.main[0].name
  vpc_security_group_ids              = [aws_security_group.db[0].id]
  publicly_accessible                 = false
  deletion_protection                 = var.deletion_protection
  skip_final_snapshot                 = !var.deletion_protection
  final_snapshot_identifier           = var.deletion_protection ? "${var.name}-db-final" : null

  tags = var.tags
}
