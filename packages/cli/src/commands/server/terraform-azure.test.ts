import { describe, expect, it } from "vitest";
import {
  AZURE_TERRAFORM_OUTPUT_KEYS,
  generateAzureApp,
  generateAzureDatabase,
  generateAzureDns,
  generateAzureIdentity,
  generateAzureMonitoring,
  generateAzureOutputs,
  generateAzureQueue,
  generateAzureReadme,
  generateAzureSecrets,
  generateAzureStorage,
  generateAzureTerraformFiles,
  generateAzureTfvarsExample,
  generateAzureVariables,
  generateAzureVersions,
  generateAzureWorker,
  type AzureTerraformOptions,
} from "./terraform-azure.ts";

const options: AzureTerraformOptions = {
  project: "acme-shelf",
  location: "eastus",
  queueBackend: "storage-queues",
};

/** Frozen output contract parsed by CI — renames break live-cloud.yml. */
const FROZEN_OUTPUT_KEYS = [
  "app_fqdn",
  "database_url",
  "entra_application_id",
  "entra_tenant_id",
  "queue_name",
  "servicebus_connection_string",
  "storage_connection_string",
];

function outputNames(outputsTf: string): string[] {
  const names: string[] = [];
  for (const match of outputsTf.matchAll(/^output "(?<name>[^"]+)" \{/gmu)) {
    const name = match.groups?.["name"];
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names.toSorted();
}

describe("Azure Terraform modules", () => {
  it("pins terraform and provider versions", () => {
    const versions = generateAzureVersions();
    expect(versions).toContain(">= 1.9");
    expect(versions).toContain("hashicorp/azurerm");
    expect(versions).toContain("hashicorp/azuread");
  });

  it("declares only live variables", () => {
    const variables = generateAzureVariables();
    expect(variables).toContain('variable "project"');
    expect(variables).toContain('variable "location"');
    expect(variables).toContain('variable "queue_backend"');
    expect(variables).toContain('variable "domain_name"');
    expect(variables).toContain('variable "entra_tenant_id"');
  });

  it("runs compute on Container Apps, not VMs or Functions", () => {
    const compute = `${generateAzureMonitoring()}${generateAzureApp()}${generateAzureWorker()}`;
    expect(compute).toContain('resource "azurerm_container_app_environment" "main"');
    expect(compute).toContain('resource "azurerm_container_app" "app"');
    expect(compute).toContain('resource "azurerm_container_app" "worker"');
    expect(compute).not.toContain("linux_virtual_machine");
    expect(compute).not.toContain("linux_function_app");
  });

  it("provisions Blob storage plus a gated Storage Queues backend", () => {
    const storage = generateAzureStorage();
    expect(storage).toContain('resource "azurerm_storage_account" "main"');
    expect(storage).toContain('resource "azurerm_storage_container" "storybook"');
    expect(storage).toContain('resource "azurerm_storage_queue" "capture"');
    expect(storage).toContain('var.queue_backend == "storage-queues" ? 1 : 0');
  });

  it("provisions a gated Service Bus backend with dead-lettering", () => {
    const queue = generateAzureQueue();
    expect(queue).toContain('resource "azurerm_servicebus_namespace" "main"');
    expect(queue).toContain('resource "azurerm_servicebus_queue" "capture"');
    expect(queue).toContain("max_delivery_count");
    expect(queue).toContain('var.queue_backend == "service-bus" ? 1 : 0');
  });

  it("uses burstable Postgres Flexible Server", () => {
    const database = generateAzureDatabase();
    expect(database).toContain('resource "azurerm_postgresql_flexible_server" "main"');
    expect(database).toContain("B_Standard_B1ms");
    expect(database).toContain('resource "azurerm_postgresql_flexible_server_database" "shelf"');
  });

  it("gates Entra identity on entra_tenant_id", () => {
    const identity = generateAzureIdentity();
    expect(identity).toContain('resource "azuread_application" "shelf"');
    expect(identity).toContain('resource "azuread_service_principal" "shelf"');
    expect(identity).toContain('var.entra_tenant_id == "" ? 0 : 1');
  });

  it("stores secrets in Key Vault, never in env", () => {
    const secrets = generateAzureSecrets();
    expect(secrets).toContain('resource "azurerm_key_vault" "main"');
    expect(secrets).toContain("ADMIN_TOKEN");
    expect(secrets).toContain("DB_PASSWORD");
  });

  it("gates DNS on domain_name", () => {
    const dns = generateAzureDns();
    expect(dns).toContain('var.domain_name == "" ? 0 : 1');
    expect(dns).toContain("azurerm_dns_zone");
    expect(dns).toContain("azurerm_dns_cname_record");
  });

  it("emits a frozen output contract for both backends", () => {
    expect(outputNames(generateAzureOutputs())).toEqual(FROZEN_OUTPUT_KEYS);
    expect([...AZURE_TERRAFORM_OUTPUT_KEYS].toSorted()).toEqual(FROZEN_OUTPUT_KEYS);
    const serviceBus = generateAzureTerraformFiles({ ...options, queueBackend: "service-bus" });
    expect(outputNames(serviceBus["terraform/outputs.tf"] ?? "")).toEqual(FROZEN_OUTPUT_KEYS);
    expect(serviceBus["terraform/queue.tf"]).toContain("azurerm_servicebus_queue");
  });

  it("references no non-Azure provider", () => {
    const files = generateAzureTerraformFiles(options);
    const bodies = Object.values(files).join("\n").toLowerCase();
    expect(bodies).not.toContain("aws_");
    expect(bodies).not.toContain("google");
    expect(bodies).not.toContain("cloudflare");
  });

  it("emits one file per module plus README and tfvars example", () => {
    const files = generateAzureTerraformFiles(options);
    for (const path of [
      "terraform/versions.tf",
      "terraform/variables.tf",
      "terraform/main.tf",
      "terraform/compute.tf",
      "terraform/database.tf",
      "terraform/storage.tf",
      "terraform/queue.tf",
      "terraform/identity.tf",
      "terraform/secrets.tf",
      "terraform/dns.tf",
      "terraform/outputs.tf",
      "terraform/terraform.tfvars.example",
      "terraform/README.md",
    ]) {
      expect(Object.keys(files)).toContain(path);
    }
    expect(files["terraform/README.md"]).toContain("terraform plan");
    expect(files["terraform/README.md"]).toContain("AZURE_STORAGE_CONNECTION");
    expect(files["terraform/README.md"]).toContain("terraform destroy");
    expect(files["terraform/terraform.tfvars.example"]).toContain("queue_backend");
  });
});

describe("Azure Terraform README", () => {
  it("documents plan-before-apply, az login, and the CI profile", () => {
    const readme = generateAzureReadme("acme-shelf", "service-bus");
    expect(readme).toContain("plan -out=tfplan");
    expect(readme).toContain("az login");
    expect(readme).toContain("AZURE_SERVICE_BUS_CONNECTION");
    expect(readme).toContain("CI test profile");
    expect(readme).toContain("shelf-ci-");
  });

  it("documents the Storage Queues env var for that backend", () => {
    const readme = generateAzureReadme("acme-shelf", "storage-queues");
    expect(readme).toContain("AZURE_STORAGE_CONNECTION");
  });
});

describe("Azure Terraform tfvars example", () => {
  it("covers every variable with CI-friendly defaults", () => {
    const example = generateAzureTfvarsExample();
    expect(example).toContain("project");
    expect(example).toContain("location");
    expect(example).toContain("queue_backend");
    expect(example).toContain("domain_name");
    expect(example).toContain("entra_tenant_id");
  });
});
