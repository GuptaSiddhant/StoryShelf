resource "aws_s3_bucket" "storybook" {
  bucket_prefix = "${var.name}-storybook-"
  force_destroy = !var.deletion_protection

  tags = var.tags
}

resource "aws_s3_bucket_versioning" "storybook" {
  bucket = aws_s3_bucket.storybook.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "storybook" {
  bucket = aws_s3_bucket.storybook.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "storybook" {
  bucket                  = aws_s3_bucket.storybook.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning keeps every overwritten and deleted object; expire the old versions so they do not
# accumulate (baselines are re-written on approval).
resource "aws_s3_bucket_lifecycle_configuration" "storybook" {
  bucket = aws_s3_bucket.storybook.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.storybook]
}
