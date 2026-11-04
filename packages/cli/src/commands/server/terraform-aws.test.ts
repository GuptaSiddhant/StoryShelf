import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
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
  type AwsTerraformOptions,
} from "./terraform-aws.ts";
import { TERRAFORM_REQUIRED_VERSION } from "./terraform-common.ts";

const options: AwsTerraformOptions = {
  project: "acme-shelf",
  region: "us-east-1",
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
    // Each provider is bounded to the major version CI validates, so a new major cannot break it.
    expect(versions).toMatch(/source\s*=\s*"hashicorp\/aws"\s*version\s*=\s*"~> 6\.0"/u);
    // random_password generates the SECRET and ADMIN_TOKEN values.
    expect(versions).toMatch(/source\s*=\s*"hashicorp\/random"\s*version\s*=\s*"~> 3\.0"/u);
  });

  it("declares only live variables", () => {
    const variables = generateAwsVariables();
    expect(variables).toContain('variable "project"');
    expect(variables).toContain('variable "region"');
    expect(variables).toContain('variable "vpc_id"');
    expect(variables).toContain('variable "domain_name"');
    expect(variables).toContain('variable "saml_metadata_url"');
    // The Postgres engine is not configurable (RDS only), so there is no variable for it.
    expect(variables).not.toContain("db_engine");
  });

  it("provisions a private S3 bucket with transient expiry", () => {
    const storage = generateAwsStorage();
    expect(storage).toContain('resource "aws_s3_bucket" "storybook"');
    expect(storage).toContain("block_public_acls");
    expect(storage).toContain("expire-transient-builds");
  });

  it("provisions RDS Postgres with an RDS-managed master password, behind a dedicated db SG", () => {
    const database = generateAwsDatabase();
    expect(database).toContain('resource "aws_db_instance" "main"');
    expect(database).toContain("manage_master_user_password = true");
    expect(database).toContain("vpc_security_group_ids      = [aws_security_group.db.id]");
    // The database is no longer attached to the task security group.
    expect(database).not.toContain("aws_security_group.ecs");
  });

  it("lets only the task security group reach Postgres, on 5432", () => {
    const security = generateAwsSecurity();
    const start = security.indexOf('resource "aws_security_group" "db"');
    expect(start).toBeGreaterThan(-1);
    const db = security.slice(start);
    const ingress = [...db.matchAll(/ingress \{(?<body>[^}]*)\}/gu)];
    expect(ingress).toHaveLength(1);
    const body = ingress[0]?.groups?.["body"] ?? "";
    expect(body).toContain("from_port       = 5432");
    expect(body).toContain("to_port         = 5432");
    expect(body).toContain("security_groups = [aws_security_group.ecs.id]");
    expect(body).not.toContain("cidr_blocks");
  });

  it("puts no plaintext database password in any generated file", () => {
    const all = Object.values(generateAwsTerraformFiles(options)).join("\n");
    expect(all).not.toMatch(/\bpassword\s*=\s*"/u);
    expect(all).not.toContain("master_password");
    expect(all).not.toMatch(/random_password"\s+"(?:db|database|master)/u);
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
    expect(generateAwsDatabase()).not.toContain("data.aws_subnets");
    expect(generateAwsDatabase()).toContain("local.private_subnet_ids");
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

  it("grants least-privilege roles: exact secret lists, and the task role also the bucket", () => {
    const compute = generateAwsCompute();
    const appSecrets = ["shelf_secret", "oidc_client_secret", "admin_token"].map(
      (secret) => `aws_secretsmanager_secret.${secret}.arn`,
    );
    // The execution role also reads the RDS-managed master secret (injected into the task).
    const expected = {
      execution_secrets: [...appSecrets, "local.db_secret_arn"],
      task_secrets: appSecrets,
    };
    expect(compute).toContain('resource "aws_iam_role" "execution"');
    expect(compute).toContain('resource "aws_iam_role" "task"');
    // Each role's secrets policy lists exactly its ARNs, in order: no extras, no wildcard.
    for (const policy of ["execution_secrets", "task_secrets"] as const) {
      const block = compute.slice(compute.indexOf(`resource "aws_iam_role_policy" "${policy}"`));
      const statement = block.slice(0, block.indexOf("\n}\n"));
      expect(statement).toContain('Action = ["secretsmanager:GetSecretValue"]');
      const resources = /Resource = \[(?<list>[^\]]*)\]/u.exec(statement)?.groups?.["list"] ?? "";
      const arns = resources
        .split(",")
        .map((arn) => arn.trim())
        .filter(Boolean);
      expect(arns).toEqual(expected[policy]);
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
      expect(generateAwsOutputs()).toContain(`output "${name}"`);
    }
  });

  it("emits a frozen output contract", () => {
    const frozen = ["alb_dns_name", "app_client_id", "db_endpoint", "s3_bucket", "user_pool_id"];
    expect(outputNames(generateAwsOutputs())).toEqual(frozen);
  });

  it("reports the RDS endpoint as db_endpoint", () => {
    expect(generateAwsOutputs()).toContain("aws_db_instance.main.endpoint");
  });

  it("no longer offers DSQL anywhere (no database preset or IAM-token flow exists for it)", () => {
    const all = Object.values(generateAwsTerraformFiles(options)).join("\n");
    expect(all.toLowerCase()).not.toContain("dsql");
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

/** The `sh -c` script the container runs, as the container sees it (HCL escapes undone). */
function containerScript(): string {
  const match = /app_command = \[\s*"sh",\s*"-c",\s*"(?<script>(?:[^"\\]|\\.)*)",\s*\]/u.exec(
    generateAwsCompute(),
  );
  return (match?.groups?.["script"] ?? "").replaceAll('\\"', '"');
}

describe("AWS stack applies and boots: database credentials, environment, secrets", () => {
  it("builds a valid, percent-encoded DATABASE_URL from the RDS credentials", () => {
    const script = containerScript();
    expect(script.endsWith("exec node src/index.ts")).toBe(true);
    // Run it for real, but print the URL instead of starting the server.
    const probe = script.replace("exec node src/index.ts", 'printf %s "$DATABASE_URL"');
    const password = "p@ss:w/rd#?%&=+ \"'$x`y";
    const result = spawnSync("sh", ["-c", probe], {
      encoding: "utf8",
      env: {
        PATH: `${dirname(process.execPath)}:${process.env["PATH"] ?? ""}`,
        DB_USERNAME: "shelf",
        DB_PASSWORD: password,
        DB_HOST: "db.example.internal",
      },
    });
    expect(result.status).toBe(0);
    const url = new URL(result.stdout);
    expect(url.username).toBe("shelf");
    expect(decodeURIComponent(url.password)).toBe(password);
    expect(url.hostname).toBe("db.example.internal");
    expect(url.port).toBe("5432");
    expect(url.pathname).toBe("/shelf");
    expect(url.search).toBe("?sslmode=require");
  });

  it("gives the task the database parts, the public URL and the app secrets", () => {
    const compute = generateAwsCompute();
    expect(compute).toContain("command      = local.app_command");
    expect(compute).toContain('{ name = "PUBLIC_BASE_URL", value = local.public_base_url }');
    expect(compute).toContain('{ name = "DB_HOST", value = aws_db_instance.main.address }');
    expect(compute).toContain(
      '{ name = "DB_USERNAME", valueFrom = "${local.db_secret_arn}:username::" }',
    );
    expect(compute).toContain(
      '{ name = "DB_PASSWORD", valueFrom = "${local.db_secret_arn}:password::" }',
    );
    for (const name of ["SECRET", "ADMIN_TOKEN"]) {
      expect(compute).toMatch(
        new RegExp(
          `\\{ name = "${name}", valueFrom = aws_secretsmanager_secret\\.\\w+\\.arn \\}`,
          "u",
        ),
      );
    }
    expect(compute).toContain(
      "db_secret_arn   = aws_db_instance.main.master_user_secret[0].secret_arn",
    );
  });

  it("derives PUBLIC_BASE_URL from the domain, else from the ALB DNS name", () => {
    expect(generateAwsCompute()).toContain(
      'public_base_url = var.domain_name == "" ? "http://${aws_lb.main.dns_name}" : "https://${var.domain_name}"',
    );
  });

  it("sets COGNITO_DOMAIN only if the identity file creates a user pool domain", () => {
    const createsDomain = generateAwsIdentity().includes("aws_cognito_user_pool_domain");
    expect(generateAwsCompute().includes("COGNITO_DOMAIN")).toBe(createsDomain);
  });

  it("generates SECRET and ADMIN_TOKEN, and leaves a never-overwritten OIDC placeholder", () => {
    const secrets = generateAwsSecrets();
    for (const name of ["shelf_secret", "admin_token"]) {
      expect(secrets).toContain(`resource "random_password" "${name}"`);
      expect(secrets).toContain(`resource "aws_secretsmanager_secret_version" "${name}"`);
      expect(secrets).toContain(`secret_string = random_password.${name}.result`);
    }
    // OIDC_CLIENT_SECRET is the operator's: a placeholder, and Terraform never reverts the real value.
    expect(secrets).not.toContain('resource "random_password" "oidc_client_secret"');
    const oidc = secrets.slice(
      secrets.indexOf('resource "aws_secretsmanager_secret_version" "oidc_client_secret"'),
    );
    expect(oidc).toContain('secret_string = "change-me"');
    expect(oidc).toContain("ignore_changes = [secret_string]");
  });

  it("starts the service only after the secrets have values and a listener has the target group", () => {
    const compute = generateAwsCompute();
    const service = compute.slice(compute.indexOf('resource "aws_ecs_service" "app"'));
    const dependsOn = /depends_on = \[(?<list>[^\]]*)\]/u.exec(service)?.groups?.["list"] ?? "";
    for (const dependency of [
      "aws_lb_listener.http",
      "aws_lb_listener.https",
      "aws_secretsmanager_secret_version.shelf_secret",
      "aws_secretsmanager_secret_version.oidc_client_secret",
      "aws_secretsmanager_secret_version.admin_token",
    ]) {
      expect(dependsOn).toContain(dependency);
    }
  });
});

describe("AWS stack TLS when domain_name is set", () => {
  it("validates the ACM certificate with DNS records in the zone", () => {
    const dns = generateAwsDns();
    expect(dns).toContain('resource "aws_route53_record" "cert_validation"');
    expect(dns).toContain("aws_acm_certificate.main[0].domain_validation_options");
    expect(dns).toContain("zone_id         = aws_route53_zone.main[0].zone_id");
    expect(dns).toContain('resource "aws_acm_certificate_validation" "main"');
    expect(dns).toContain("validation_record_fqdns");
    expect(dns).toContain('count                   = var.domain_name == "" ? 0 : 1');
  });

  it("serves HTTPS with the validated certificate and creates no HTTPS listener without a domain", () => {
    const compute = generateAwsCompute();
    const https = compute.slice(compute.indexOf('resource "aws_lb_listener" "https"'));
    expect(https).toContain('count             = var.domain_name == "" ? 0 : 1');
    expect(https).toContain(
      "certificate_arn   = aws_acm_certificate_validation.main[0].certificate_arn",
    );
    // Never the raw (possibly still pending) certificate.
    expect(compute).not.toContain("certificate_arn   = aws_acm_certificate.main[0].arn");
  });

  it("redirects port 80 to HTTPS with a 301 when a domain is set, and forwards otherwise", () => {
    const compute = generateAwsCompute();
    const start = compute.indexOf('resource "aws_lb_listener" "http"');
    const http = compute.slice(start, compute.indexOf('resource "aws_lb_listener" "https"'));
    // Two default_action blocks, each gated on the domain: forward without one, redirect with one.
    const [, forward = "", redirect = ""] = http.split('dynamic "default_action"');
    expect(forward).toContain('for_each = var.domain_name == "" ? [1] : []');
    expect(forward).toContain('type             = "forward"');
    expect(redirect).toContain('for_each = var.domain_name == "" ? [] : [1]');
    expect(redirect).toContain('type = "redirect"');
    expect(redirect).toContain('status_code = "HTTP_301"');
    expect(redirect).toContain('protocol    = "HTTPS"');
    expect(redirect).toContain('port        = "443"');
    expect(redirect).not.toContain("target_group_arn");
  });
});

describe("AWS README operator steps", () => {
  const readme = generateAwsReadme("acme-shelf");

  it("explains how to delegate the domain to the new Route 53 zone", () => {
    expect(readme).toContain("terraform apply -target='aws_route53_zone.main'");
    expect(readme).toContain("terraform state show 'aws_route53_zone.main[0]'");
    expect(readme).toContain("name_servers");
    expect(readme).toContain("NS records");
  });

  it("explains how to set OIDC_CLIENT_SECRET and where the generated secrets live", () => {
    expect(readme).toContain("aws secretsmanager put-secret-value");
    expect(readme).toContain("<project>/OIDC_CLIENT_SECRET");
    expect(readme).toContain("--force-new-deployment");
    expect(readme).toContain("Terraform state");
    expect(readme.toLowerCase()).not.toContain("dsql");
  });
});
