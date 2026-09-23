---
title: Azure deployment
description: Deploy StoryShelf on Azure with Container Apps, Blob Storage, Queues/Service Bus, Postgres, and Entra ID.
---

For Azure enterprise deployments, `storyshelf server init` offers an `azure` deploy target that pins the full reference stack — Container Apps app + worker, Blob storage, Storage Queues or Service Bus (your choice; Service Bus dead-letters poison messages natively), Postgres Flexible Server (B1ms burstable default), Key Vault, Microsoft Entra app registration, and an optional DNS zone — and writes it as Terraform under `terraform/`.

## Scaffold

```bash
storyshelf server init
# ? Deploy target? Azure (Container Apps + Blob + Queues/Service Bus + Postgres + Entra)
# ? Azure region? eastus
# ? Azure capture queue backend? Storage Queues / Service Bus
# ? Public domain for the app? (empty skips DNS)
# ? Entra tenant ID for the app registration? (empty skips it)
```

## Apply

```bash
cd my-server
az login
terraform -chdir=terraform init
terraform -chdir=terraform plan -out=tfplan   # review before applying
terraform -chdir=terraform apply tfplan       # or: npm run infra:apply
```

## Wiring outputs

Wire the outputs into env (`terraform output -json` / `npm run infra:outputs`): `AZURE_STORAGE_CONNECTION` (+ `AZURE_SERVICE_BUS_CONNECTION` for that backend), `DATABASE_URL`, `OIDC_CLIENT_ID` / `OIDC_ISSUER` (`https://login.microsoftonline.com/{tenant}/v2.0`), `SECRET`. Output keys (`app_fqdn`, `storage_connection_string`, `servicebus_connection_string`, `queue_name`, `database_url`, `entra_application_id`, `entra_tenant_id`) are a stable contract parsed by CI — always present, `""` when not provisioned for the backend.

Authenticate with `az login` (or a service principal / managed identity) — never check connection strings into env files. Hostname binding + managed TLS is a post-apply step once the scaffolded DNS records resolve (see the generated `terraform/README.md`, including the CI test profile with unique project prefix per run and documented destroy).

Pair with [@storyshelf/storage-azure](/packages/storage-azure/) and [@storyshelf/queue-azure](/packages/queue-azure/).

## Related

- [Deployment overview](/guides/deployment/) — Docker Compose, subdomains, auth, other clouds
