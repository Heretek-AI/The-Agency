#!/usr/bin/env bun
// Usage: bun scripts/check-host-contract.ts [path-to-opencode-v2-checkout]
import * as path from "node:path"
import { checkHostContract, formatContractCheck } from "../src/host/contract-check.js"

const defaultFixture = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../test/fixtures/opencode-v2-ref")
const sourceDir = process.argv[2] ?? process.env.OPENCODE_V2_SRC ?? defaultFixture

const report = await checkHostContract(sourceDir)
console.log(formatContractCheck(report))
process.exit(report.ok ? 0 : 1)
