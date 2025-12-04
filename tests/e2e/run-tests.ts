#!/usr/bin/env node
/**
 * Test runner for E2E tests
 * Run with: npx ts-node tests/e2e/run-tests.ts [test-file]
 * 
 * Examples:
 *   npx ts-node tests/e2e/run-tests.ts start.test
 *   npx ts-node tests/e2e/run-tests.ts apply.test
 */

const testFile = process.argv[2] || "start.test";

if (testFile === "start.test") {
  const {runTests} = require("./start.test");
  runTests().catch((error: any) => {
    console.error("Test runner error:", error);
    process.exit(1);
  });
} else if (testFile === "apply.test") {
  const {runTests} = require("./apply.test");
  runTests().catch((error: any) => {
    console.error("Test runner error:", error);
    process.exit(1);
  });
} else {
  console.error(`Unknown test file: ${testFile}`);
  console.error("Available: start.test, apply.test");
  process.exit(1);
}

