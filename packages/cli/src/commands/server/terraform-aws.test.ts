import { describe, expect, it } from "vitest";
import {
  generateAwsCompute,
  generateAwsDatabase,
  generateAwsDns,
  generateAwsEndpoints,
  generateAwsIdentity,
  generateAwsOutputs,
  generateAwsReadme,
  generateAwsSecrets,
  generateAwsSecurity,
  generateAwsStorage,
  generateAwsTerraformFiles,
  generateAwsVariables,
  generateAwsVersions,
  generateAwsVpc,
  TERRAFORM_REQUIRED_VERSION,
  type AwsTerraformOptions,
} from "./terraform-aws.ts";

const options: AwsTerraformOptions = {
  project: "acme-shelf",
  region: "us-east-1",
  dbEngine: "rds",
};

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

describe("AWS Terraform modules", () => {
  it("pins terraform and provider versions", () => {
    const versions = generateAwsVersions();
    expect(versions).toContain(TERRAFORM_REQUIRED_VERSION);
    expect(versions).toContain("hashicorp/aws");
  });

  it("declares only live variables", () => {
    const variables = generateAwsVariables();
    expect(variables).toContain('variable "project"');
    expect(variables).toContain('variable "region"');
    expect(variables).toContain('variable "vpc_id"');
    expect(variables).toContain('variable "domain_name"');
    expect(variables).toContain('variable "saml_metadata_url"');
    // db_engine is baked at scaffold time, like storage; a
    // variable here would be dead config that terraform validate flags.
    expect(variables).not.toContain("db_engine");
  });

  it("provisions a private S3 bucket with transient expiry", () => {
    const storage = generateAwsStorage();
    expect(storage).toContain('resource "aws_s3_bucket" "storybook"');
    expect(storage).toContain("block_public_acls");
    expect(storage).toContain("expire-transient-builds");
  });

  it("uses RDS by default and DSQL on request", () => {
    expect(generateAwsDatabase("rds")).toContain('resource "aws_db_instance" "main"');
    expect(generateAwsDatabase("rds")).not.toContain("aws_dsql_cluster");
    expect(generateAwsDatabase("dsql")).toContain('resource "aws_dsql_cluster" "main"');
    expect(generateAwsDatabase("dsql")).not.toContain("aws_db_instance");
  });

  it("keeps data-plane traffic private and compute on Fargate", () => {
    const network = `${generateAwsVpc()}${generateAwsSecurity()}${generateAwsEndpoints()}`;
    expect(network).toContain('resource "aws_vpc_endpoint" "s3"');
    expect(network).not.toContain("sqs");
    const compute = generateAwsCompute();
    expect(compute).toContain('resource "aws_ecs_cluster" "main"');
    expect(compute).toContain('resource "aws_lb" "main"');
    expect(compute).not.toContain("lambda");
  });

  it("creates a usable network with the VPC: subnets, IGW and public route table, no NAT", () => {
    const vpc = generateAwsVpc();
    expect(vpc).toContain('resource "aws_subnet" "public"');
    expect(vpc).toContain('resource "aws_subnet" "private"');
    expect(vpc).toContain('Tier = "public"');
    expect(vpc).toContain('Tier = "private"');
    expect(vpc).toContain("data.aws_availability_zones.available[0].names[count.index]");
    expect(vpc).toContain('resource "aws_internet_gateway" "main"');
    expect(vpc).toContain('resource "aws_route_table" "public"');
    expect(vpc).toContain('resource "aws_route_table_association" "public"');
    expect(vpc).not.toContain("aws_nat_gateway");
    expect(vpc).not.toContain("aws_eip");
  });

  it("looks up Tier-tagged subnets when an existing vpc_id is supplied", () => {
    const vpc = generateAwsVpc();
    expect(vpc).toContain('data "aws_subnets" "public"');
    expect(vpc).toContain('data "aws_subnets" "private"');
    expect(vpc).toContain('tags = { Tier = "public" }');
    expect(vpc).toContain('tags = { Tier = "private" }');
    expect(vpc).toContain('count = var.vpc_id == "" ? 0 : 1');
  });

  it("exposes created-or-looked-up subnet ids in one place for compute and database", () => {
    const vpc = generateAwsVpc();
    expect(vpc).toContain("public_subnet_ids");
    expect(vpc).toContain("private_subnet_ids");
    expect(generateAwsCompute()).not.toContain("data.aws_subnets");
    expect(generateAwsDatabase("rds")).not.toContain("data.aws_subnets");
    expect(generateAwsDatabase("rds")).toContain("local.private_subnet_ids");
  });

  it("runs the service and the ALB in public subnets with a public IP, tasks reachable only via the ALB", () => {
    const compute = generateAwsCompute();
    expect(compute).toContain("subnets            = local.public_subnet_ids");
    expect(compute).toContain("subnets          = local.public_subnet_ids");
    expect(compute).toContain("assign_public_ip = true");
    expect(compute).not.toContain("assign_public_ip = false");
    // The task security group admits only the ALB security group.
    const security = generateAwsSecurity();
    expect(security).toContain("security_groups = [aws_security_group.alb.id]");
  });

  it("grants least-privilege roles: both read exactly the three secrets, task also the bucket", () => {
    const compute = generateAwsCompute();
    const secrets = ["shelf_secret", "oidc_client_secret", "admin_token"];
    expect(compute).toContain('resource "aws_iam_role" "execution"');
    expect(compute).toContain('resource "aws_iam_role" "task"');
    // Each role's secrets policy lists exactly the three scaffold ARNs and nothing broader.
    for (const policy of ["execution_secrets", "task_secrets"]) {
      const block = compute.slice(compute.indexOf(`resource "aws_iam_role_policy" "${policy}"`));
      const statement = block.slice(0, block.indexOf("\n}\n"));
      expect(statement).toContain('Action = ["secretsmanager:GetSecretValue"]');
      for (const secret of secrets) {
        expect(statement).toContain(`aws_secretsmanager_secret.${secret}.arn`);
      }
    }
    // The task role reaches the bucket (its own policy), not just the secrets.
    const storage = compute.slice(compute.indexOf('resource "aws_iam_role_policy" "task_storage"'));
    expect(storage.slice(0, storage.indexOf("\n}\n"))).toContain("aws_s3_bucket.storybook.arn");
    expect(compute).not.toContain('Resource = "*"');
    expect(compute).not.toContain("secretsmanager:*");
  });

  it("runs the app as one ECS service behind the ALB, with no worker", () => {
    const compute = generateAwsCompute();
    expect(compute).toContain('resource "aws_ecs_task_definition" "app"');
    expect(compute).toContain('resource "aws_ecs_service" "app"');
    expect(compute).toContain('resource "aws_lb_target_group" "app"');
    expect(compute).toContain('resource "aws_lb_listener" "http"');
    expect(compute).not.toContain('resource "aws_ecs_service" "worker"');
    expect(compute).not.toContain('resource "aws_ecs_task_definition" "worker"');
    expect(compute).not.toContain("aws_appautoscaling");
  });

  it("wires the service to the existing secrets and log group", () => {
    const compute = generateAwsCompute();
    for (const secret of ["shelf_secret", "oidc_client_secret", "admin_token"]) {
      expect(compute).toContain(`aws_secretsmanager_secret.${secret}.arn`);
    }
    expect(compute).toContain("aws_cloudwatch_log_group.app.name");
  });

  it("provisions Cognito with an admin group and optional SAML", () => {
    const identity = generateAwsIdentity();
    expect(identity).toContain('resource "aws_cognito_user_pool" "main"');
    expect(identity).toContain('"shelf-admins"');
    expect(identity).toContain("var.saml_metadata_url");
  });

  it("stores secrets in Secrets Manager, never in env", () => {
    const secrets = generateAwsSecrets();
    expect(secrets).toContain("aws_secretsmanager_secret");
    expect(secrets).toContain("ADMIN_TOKEN");
  });

  it("gates DNS on domain_name", () => {
    const dns = generateAwsDns();
    expect(dns).toContain('var.domain_name == "" ? 0 : 1');
    expect(dns).toContain("aws_acm_certificate");
    expect(dns).toContain("aws_route53_record");
  });

  it("outputs every env var the server needs", () => {
    for (const name of [
      "alb_dns_name",
      "s3_bucket",
      "db_endpoint",
      "user_pool_id",
      "app_client_id",
    ]) {
      expect(generateAwsOutputs("rds")).toContain(`output "${name}"`);
      expect(generateAwsOutputs("dsql")).toContain(`output "${name}"`);
    }
  });

  it("emits a frozen output contract for both engines", () => {
    const frozen = ["alb_dns_name", "app_client_id", "db_endpoint", "s3_bucket", "user_pool_id"];
    for (const engine of ["rds", "dsql"] as const) {
      expect(outputNames(generateAwsOutputs(engine))).toEqual(frozen);
    }
  });

  it("derives the DSQL endpoint from the documented format", () => {
    const dsql = generateAwsOutputs("dsql");
    expect(dsql).toContain(".dsql.");
    expect(dsql).toContain(".on.aws");
    expect(dsql).toContain("aws_dsql_cluster.main.identifier");
    expect(generateAwsOutputs("rds")).toContain("aws_db_instance.main.endpoint");
  });

  it("references no non-AWS provider", () => {
    const files = generateAwsTerraformFiles(options);
    const bodies = Object.values(files).join("\n").toLowerCase();
    expect(bodies).not.toContain("google");
    expect(bodies).not.toContain("azurerm");
    expect(bodies).not.toContain("cloudflare");
  });

  it("emits one file per module plus database and README", () => {
    const files = generateAwsTerraformFiles(options);
    expect(Object.keys(files)).not.toContain("terraform/queue.tf");
    expect(Object.values(files).join("\n").toLowerCase()).not.toMatch(/sqs|queue|worker/u);
    for (const path of [
      "terraform/versions.tf",
      "terraform/variables.tf",
      "terraform/network.tf",
      "terraform/storage.tf",
      "terraform/identity.tf",
      "terraform/compute.tf",
      "terraform/secrets.tf",
      "terraform/dns.tf",
      "terraform/outputs.tf",
      "terraform/database.tf",
      "terraform/terraform.tfvars.example",
      "terraform/README.md",
    ]) {
      expect(Object.keys(files)).toContain(path);
    }
    expect(files["terraform/README.md"]).toContain("terraform plan");
    expect(files["terraform/README.md"]).toContain("S3_BUCKET");
    expect(files["terraform/README.md"]).toContain("terraform destroy");
    expect(files["terraform/terraform.tfvars.example"]).toContain("saml_metadata_url");
  });
});

describe("AWS Terraform README networking notes", () => {
  it("documents the Tier tags, the no-NAT choice and the two-AZ subnet requirements", () => {
    const readme = generateAwsReadme("acme");
    expect(readme).toContain("Tier = public");
    expect(readme).toContain("Tier = private");
    expect(readme).toContain("no NAT gateway");
    // Each tier gets its own clause: two subnets in different AZs, bound to that tier's tag.
    expect(readme).toMatch(
      /at least two public\s+subnets in different availability zones\s+`Tier = public`/u,
    );
    expect(readme).toMatch(/at least two in\s+different availability zones\s+`Tier = private`/u);
  });
});

describe("AWS Terraform README", () => {
  it("documents plan-before-apply and IAM credentials", () => {
    const readme = generateAwsReadme("acme-shelf");
    expect(readme).toContain("plan -out=tfplan");
    expect(readme).toContain("IAM");
    expect(readme).toContain("CI test profile");
    expect(readme).toContain("shelf-ci-");
  });
});
