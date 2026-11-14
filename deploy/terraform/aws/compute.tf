# ECS Fargate: one service of identical copies behind the load balancer. Every copy serves the app
# and consumes the capture queue in the database, and renders in the container (the image ships
# Chromium). The module deploys the published image and never builds one.
locals {
  public_base_url = var.domain_name == "" ? "http://${aws_lb.main.dns_name}" : "https://${var.domain_name}"
  image           = "${var.image_repository}:${var.image_version}"

  # The task is stopped after the grace plus a margin for the process to exit; the load balancer
  # keeps the target draining for the grace, so no request lands on a copy that is shutting down.
  stop_timeout = var.shutdown_grace_seconds + 10

  database_environment = local.create_database ? [
    { name = "DATABASE_IAM_HOST", value = aws_db_instance.main[0].address },
    { name = "DATABASE_IAM_USER", value = local.database_user },
    { name = "DATABASE_IAM_NAME", value = local.database_name },
    { name = "DATABASE_IAM_REGION", value = var.region },
  ] : []

  database_secrets = local.create_database ? [] : [
    { name = "DATABASE_URL", valueFrom = var.existing_database_url_secret_arn },
  ]

  remote_browser_secrets = concat(
    var.remote_browser_endpoint_secret_arn == "" ? [] : [{ name = "REMOTE_BROWSER_ENDPOINT", valueFrom = var.remote_browser_endpoint_secret_arn }],
    var.remote_browser_token_secret_arn == "" ? [] : [{ name = "REMOTE_BROWSER_TOKEN", valueFrom = var.remote_browser_token_secret_arn }],
  )
}

resource "aws_lb" "main" {
  name               = "${var.name}-alb"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = local.public_subnet_ids

  tags = var.tags
}

resource "aws_lb_target_group" "app" {
  name                 = "${var.name}-app"
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = local.vpc_id
  deregistration_delay = var.shutdown_grace_seconds

  health_check {
    path    = "/api/v1/health"
    matcher = "200"
  }

  tags = var.tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  dynamic "default_action" {
    for_each = var.domain_name == "" ? [1] : []

    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.app.arn
    }
  }

  dynamic "default_action" {
    for_each = var.domain_name == "" ? [] : [1]

    content {
      type = "redirect"

      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }

  tags = var.tags
}

resource "aws_lb_listener" "https" {
  count             = var.domain_name == "" ? 0 : 1
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = aws_acm_certificate_validation.main[0].certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }

  tags = var.tags
}

resource "aws_ecs_cluster" "main" {
  name = "${var.name}-cluster"

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${var.name}-app"
  retention_in_days = var.log_retention_days

  tags = var.tags
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${var.name}-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name         = "app"
    image        = local.image
    essential    = true
    stopTimeout  = local.stop_timeout
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    environment = concat([
      { name = "AWS_BUCKET", value = aws_s3_bucket.storybook.id },
      { name = "AWS_REGION", value = var.region },
      { name = "PUBLIC_BASE_URL", value = local.public_base_url },
      { name = "TRUST_PROXY", value = "1" },
      { name = "SHUTDOWN_GRACE_SECONDS", value = tostring(var.shutdown_grace_seconds) },
      { name = "DATABASE_POOL_MAX", value = tostring(var.database_pool_size) },
    ], local.database_environment)
    secrets = concat([
      { name = "SECRET", valueFrom = aws_secretsmanager_secret.shelf_secret.arn },
      { name = "OIDC_CLIENT_SECRET", valueFrom = aws_secretsmanager_secret.oidc_client_secret.arn },
      { name = "ADMIN_TOKEN", valueFrom = aws_secretsmanager_secret.admin_token.arn },
    ], local.database_secrets, local.remote_browser_secrets)
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "app"
      }
    }
  }])

  tags = var.tags
}

resource "aws_ecs_service" "app" {
  name            = "${var.name}-app"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.min_instances
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = local.public_subnet_ids
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 3000
  }

  # Autoscaling owns the count once it exists.
  lifecycle {
    ignore_changes = [desired_count]
  }

  # The target group must be on a listener, and the secrets must have values, before the first
  # task starts (a task cannot fetch a secret that has no version).
  depends_on = [
    aws_lb_listener.http,
    aws_lb_listener.https,
    aws_secretsmanager_secret_version.shelf_secret,
    aws_secretsmanager_secret_version.oidc_client_secret,
    aws_secretsmanager_secret_version.admin_token,
    aws_iam_role_policy.task,
    aws_iam_role_policy.execution_secrets,
  ]

  tags = var.tags
}

# Identical copies between min_instances and max_instances, scaled on CPU.
resource "aws_appautoscaling_target" "app" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.min_instances
  max_capacity       = max(var.min_instances, var.max_instances)
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${var.name}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.app.service_namespace
  resource_id        = aws_appautoscaling_target.app.resource_id
  scalable_dimension = aws_appautoscaling_target.app.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
