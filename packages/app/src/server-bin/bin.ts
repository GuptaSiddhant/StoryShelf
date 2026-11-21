#!/usr/bin/env node
import { processIo } from "./io.ts";
import { runServerBin } from "./main.ts";

process.exitCode = await runServerBin(process.argv.slice(2), processIo);
