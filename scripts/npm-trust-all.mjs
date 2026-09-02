// oxlint-disable max-statements curly no-console no-inline-comments
import { execSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { getPublicPackageNames } from "./public-packages.mjs";

let npm = "npm";
try {
  execSync("npm --version", { stdio: "ignore" });
} catch {
  npm = `~/.local/share/node-v26.8.1-linux-arm64/bin/npm`;
}

const packages = getPublicPackageNames();

for (let index = 0; index < packages.length; index += 1) {
  const name = packages[index];
  const cmd = [
    `${npm} trust github`,
    name,
    '--repo="GuptaSiddhant/storyshelf"',
    '--file="release.yml"',
    "--allow-publish",
    "--yes",
  ].join(" ");

  console.log(`\nTrusting package: ${name}`);
  try {
    execSync(cmd, { stdio: index === 0 ? "inherit" : "pipe" });
    // oxlint-disable-next-line no-await-in-loop
    await setTimeout(2000); // Wait for 2 seconds to avoid rate limiting
  } catch (error) {
    if (index === 0) {
      console.error(`Error trusting package ${name}:`, error);
      continue;
    }

    if (error instanceof Error && error.message.includes("E409")) {
      console.log(`- Package ${name} is already trusted. Skipping...`);
      continue;
    }
    throw error;
  }
}
