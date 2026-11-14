# VPC: created unless var.vpc_id points at an existing one. There is no NAT gateway (about $32 a
# month per zone): tasks run in the public subnets with a public IP and only the load balancer can
# reach them. The database sits in the private subnets only.
resource "aws_vpc" "main" {
  count                = var.vpc_id == "" ? 1 : 0
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(var.tags, { Name = "${var.name}-vpc" })
}

data "aws_availability_zones" "available" {
  count = var.vpc_id == "" ? 1 : 0
  state = "available"
}

resource "aws_subnet" "public" {
  count                   = var.vpc_id == "" ? 2 : 0
  vpc_id                  = aws_vpc.main[0].id
  availability_zone       = data.aws_availability_zones.available[0].names[count.index]
  cidr_block              = cidrsubnet(aws_vpc.main[0].cidr_block, 8, count.index)
  map_public_ip_on_launch = true

  tags = merge(var.tags, { Name = "${var.name}-public-${count.index}", Tier = "public" })
}

resource "aws_subnet" "private" {
  count             = var.vpc_id == "" ? 2 : 0
  vpc_id            = aws_vpc.main[0].id
  availability_zone = data.aws_availability_zones.available[0].names[count.index]
  cidr_block        = cidrsubnet(aws_vpc.main[0].cidr_block, 8, count.index + 10)

  tags = merge(var.tags, { Name = "${var.name}-private-${count.index}", Tier = "private" })
}

resource "aws_internet_gateway" "main" {
  count  = var.vpc_id == "" ? 1 : 0
  vpc_id = aws_vpc.main[0].id

  tags = merge(var.tags, { Name = "${var.name}-igw" })
}

resource "aws_route_table" "public" {
  count  = var.vpc_id == "" ? 1 : 0
  vpc_id = aws_vpc.main[0].id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main[0].id
  }

  tags = merge(var.tags, { Name = "${var.name}-public" })
}

resource "aws_route_table_association" "public" {
  count          = var.vpc_id == "" ? 2 : 0
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public[0].id
}

# S3 traffic stays on the AWS network (created VPC only; an existing VPC owns its endpoints).
resource "aws_vpc_endpoint" "s3" {
  count             = var.vpc_id == "" ? 1 : 0
  vpc_id            = aws_vpc.main[0].id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public[0].id]

  tags = var.tags
}

data "aws_subnets" "public" {
  count = var.vpc_id == "" ? 0 : 1

  filter {
    name   = "vpc-id"
    values = [var.vpc_id]
  }

  tags = { Tier = "public" }
}

data "aws_subnets" "private" {
  count = var.vpc_id == "" ? 0 : 1

  filter {
    name   = "vpc-id"
    values = [var.vpc_id]
  }

  tags = { Tier = "private" }
}

locals {
  vpc_id             = var.vpc_id != "" ? var.vpc_id : aws_vpc.main[0].id
  public_subnet_ids  = var.vpc_id == "" ? aws_subnet.public[*].id : flatten(data.aws_subnets.public[*].ids)
  private_subnet_ids = var.vpc_id == "" ? aws_subnet.private[*].id : flatten(data.aws_subnets.private[*].ids)
}

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Load balancer ingress"
  vpc_id      = local.vpc_id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP (redirects to HTTPS when a domain is set)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "To the app tasks"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

resource "aws_security_group" "app" {
  name        = "${var.name}-app"
  description = "App tasks: load balancer ingress only"
  vpc_id      = local.vpc_id

  ingress {
    description     = "From the load balancer"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "Image pull, AWS APIs, database, S3, remote browsers"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

resource "aws_security_group" "db" {
  count       = local.create_database ? 1 : 0
  name        = "${var.name}-db"
  description = "Postgres: app task ingress only"
  vpc_id      = local.vpc_id

  ingress {
    description     = "From the app tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  tags = var.tags
}
