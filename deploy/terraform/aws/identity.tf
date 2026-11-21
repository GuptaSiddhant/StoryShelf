# Cognito user pool (enable_cognito): the sign-in front door. Federate a corporate IdP (Entra, Okta) over SAML by
# setting var.saml_metadata_url.
resource "aws_cognito_user_pool" "main" {
  count = var.enable_cognito ? 1 : 0
  name  = "${var.name}-users"

  tags = var.tags
}

resource "aws_cognito_user_pool_client" "shelf" {
  count           = var.enable_cognito ? 1 : 0
  name            = "${var.name}-shelf"
  user_pool_id    = aws_cognito_user_pool.main[0].id
  generate_secret = true

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = ["${local.public_base_url}/auth/callback"]
  supported_identity_providers         = var.saml_metadata_url == "" ? ["COGNITO"] : ["COGNITO", "CorporateSAML"]

  depends_on = [aws_cognito_identity_provider.saml]
}

resource "aws_cognito_user_group" "admins" {
  count        = var.enable_cognito ? 1 : 0
  name         = "shelf-admins"
  user_pool_id = aws_cognito_user_pool.main[0].id
}

resource "aws_cognito_identity_provider" "saml" {
  count         = var.enable_cognito && var.saml_metadata_url != "" ? 1 : 0
  user_pool_id  = aws_cognito_user_pool.main[0].id
  provider_name = "CorporateSAML"
  provider_type = "SAML"

  provider_details = {
    MetadataURL = var.saml_metadata_url
  }
}
