output "url" {
  description = "Public base URL of the app."
  value       = local.public_base_url
}

output "alb_dns_name" {
  description = "DNS name of the load balancer (point your domain's CNAME or alias here when you manage DNS yourself)."
  value       = aws_lb.main.dns_name
}

output "s3_bucket" {
  description = "Storybook bucket."
  value       = aws_s3_bucket.storybook.id
}

output "db_endpoint" {
  description = "Database endpoint (null with an existing database URL)."
  value       = local.create_database ? aws_db_instance.main[0].endpoint : null
}

output "db_master_secret_arn" {
  description = "ARN of the RDS-managed master secret an operator uses once to create the IAM database user (null with an existing database URL). A reference, not a value."
  value       = local.create_database ? aws_db_instance.main[0].master_user_secret[0].secret_arn : null
}

output "db_iam_user" {
  description = "Name of the database user the app logs in as with IAM authentication."
  value       = local.database_user
}

output "user_pool_id" {
  description = "Cognito user pool id."
  value       = aws_cognito_user_pool.main.id
}

output "app_client_id" {
  description = "Cognito app client id."
  value       = aws_cognito_user_pool_client.shelf.id
}

output "cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.main.name
}

output "service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.app.name
}

output "admin_token_secret_arn" {
  description = "Secrets Manager ARN of the break-glass ADMIN_TOKEN (read it with the AWS CLI; it is not an output value)."
  value       = aws_secretsmanager_secret.admin_token.arn
}

output "auth_password_secret_arn" {
  description = "Secrets Manager ARN of the generated admin password (read it with the AWS CLI; it is not an output value)."
  value       = aws_secretsmanager_secret.auth_password.arn
}

output "oidc_client_secret_arn" {
  description = "Secrets Manager ARN to put the real OIDC client secret into."
  value       = aws_secretsmanager_secret.oidc_client_secret.arn
}

output "task_role_arn" {
  description = "ARN of the app's task role."
  value       = aws_iam_role.task.arn
}

output "task_role_policy_json" {
  description = "The exact least-privilege policy of the task role: bucket access, rds-db:connect for the app's database user, and the app's own log stream writes."
  value       = data.aws_iam_policy_document.task.json
}

output "execution_role_policy_json" {
  description = "The policy that lets ECS resolve the app's secret references, in addition to AmazonECSTaskExecutionRolePolicy."
  value       = data.aws_iam_policy_document.execution_secrets.json
}
