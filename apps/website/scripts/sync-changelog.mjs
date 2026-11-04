// Publishes the repo's CHANGELOG.md as the docs "Changelog" page.
// The generated file (src/content/docs/changelog.md) is gitignored; this runs
// before every build and dev server start so it never drifts from the source.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const here = import.meta.dirname;
const source = join(here, "..", "..", "..", "CHANGELOG.md");
const target = join(here, "..", "src", "content", "docs", "changelog.md");

// Drop the top-level "# Changelog" heading: the page title comes from frontmatter.
const body = readFileSync(source, "utf8").replace(/^# Changelog\s*\n/u, "");
const page = `---
title: Changelog
description: What changed in each StoryShelf release.
editUrl: https://github.com/GuptaSiddhant/StoryShelf/edit/main/CHANGELOG.md
---

${body}`;

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, page);
process.stdout.write("changelog.md synced from CHANGELOG.md\n");
