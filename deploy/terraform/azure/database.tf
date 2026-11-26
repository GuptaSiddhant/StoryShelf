# Two logins. `shelf` is the server's administrator (a member of azure_pg_admin), kept for
# operators; its password is in Key Vault as DATABASE-ADMIN-PASSWORD and never in the app
# container's environment. The app logs in as `shelf_app`, an ordinary role that the `db-init` init
# container creates and grants rights on the `shelf` database and its `public` schema. Both
# passwords are generated, written only to Key Vault (secrets.tf) and, because Terraform manages
# them, to the state: keep the state in an encrypted backend with restricted access.
locals {
  database_name       = "shelf"
  database_admin_user = "shelf"
  database_app_user   = "shelf_app"
}

resource "random_password" "database" {
  count   = local.create_database ? 1 : 0
  length  = 32
  special = false
}

resource "random_password" "database_app" {
  count   = local.create_database ? 1 : 0
  length  = 32
  special = false
}

resource "azurerm_postgresql_flexible_server" "main" {
  count               = local.create_database ? 1 : 0
  name                = "${var.name}-db-${random_string.suffix.result}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  version             = "16"
  # Stays `shelf`: the login cannot be renamed without replacing the server.
  administrator_login           = local.database_admin_user
  administrator_password        = random_password.database[0].result
  sku_name                      = var.database_sku_name
  storage_mb                    = var.database_storage_mb
  backup_retention_days         = 7
  delegated_subnet_id           = azurerm_subnet.database[0].id
  private_dns_zone_id           = azurerm_private_dns_zone.database[0].id
  public_network_access_enabled = false

  # Azure picks the zone; naming it back would force a replacement.
  lifecycle {
    ignore_changes = [zone]
  }

  depends_on = [azurerm_private_dns_zone_virtual_network_link.database]

  tags = var.tags
}

resource "azurerm_postgresql_flexible_server_database" "shelf" {
  count     = local.create_database ? 1 : 0
  name      = local.database_name
  server_id = azurerm_postgresql_flexible_server.main[0].id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_management_lock" "database" {
  count      = local.create_database && var.deletion_protection ? 1 : 0
  name       = "${var.name}-database-protect"
  scope      = azurerm_postgresql_flexible_server.main[0].id
  lock_level = "CanNotDelete"
  notes      = "deletion_protection of the StoryShelf module"
}

locals {
  # Idempotent: runs before the app container on every replica start, as the administrator, over
  # TLS verified against the system roots (the server's certificate chains to a public root and
  # names the FQDN). It creates the app role or resets its password, grants it the database and the
  # `public` schema, and hands it whatever the administrator owns in `public` (the tables an earlier
  # version of the module let the app create as the administrator). The app's password comes from
  # the DATABASE_URL secret, so it is stored once.
  db_init_script = <<-EOT
    set -e
    APP_PASSWORD=$(printf '%s' "$APP_DATABASE_URL" | sed -E 's#^[^:]*://[^:]*:([^@]*)@.*$#\1#')
    export APP_PASSWORD
    psql -v ON_ERROR_STOP=1 -v app_user=${local.database_app_user} -v app_db=${local.database_name} <<'SQL'
    \getenv app_password APP_PASSWORD
    SELECT format('CREATE ROLE %I LOGIN', :'app_user') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') \gexec
    SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'app_user', :'app_password') \gexec
    SELECT format('GRANT ALL ON DATABASE %I TO %I', :'app_db', :'app_user') \gexec
    SELECT format('GRANT ALL ON SCHEMA public TO %I', :'app_user') \gexec
    SELECT format('GRANT %I TO %I', :'app_user', current_user) WHERE NOT pg_has_role(current_user, :'app_user', 'SET') \gexec
    SELECT format('ALTER %s public.%I OWNER TO %I', CASE c.relkind WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END, c.relname, :'app_user')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relowner = current_user::text::regrole AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
        AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i')) \gexec
    SQL
  EOT

  db_init_env = local.create_database ? {
    PGHOST        = azurerm_postgresql_flexible_server.main[0].fqdn
    PGDATABASE    = local.database_name
    PGUSER        = local.database_admin_user
    PGSSLMODE     = "verify-full"
    PGSSLROOTCERT = "system"
  } : {}

  # Environment variable -> Container App secret name. Only the init container gets these.
  db_init_secret_env = local.create_database ? {
    PGPASSWORD       = "database-admin-password"
    APP_DATABASE_URL = "database-url"
  } : {}
}
