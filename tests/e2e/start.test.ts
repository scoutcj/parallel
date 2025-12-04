import {execSync} from "child_process";
import {existsSync, readFileSync} from "fs";
import {join} from "path";
import {
  createTestRepo,
  createMockAgent,
  createTestPackageJson,
  createTestEnvFile,
  runGitPrl,
  worktreeExists,
  branchExists,
  getCurrentBranch,
  fileExists,
  readFile,
  type TestRepo
} from "./setup";

// Simple test runner
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const tests: Array<() => Promise<TestResult>> = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  tests.push(async () => {
    try {
      await fn();
      return {name, passed: true};
    } catch (error: any) {
      return {name, passed: false, error: error.message || String(error)};
    }
  });
}

async function runTests() {
  console.log("🧪 Running E2E tests for `git prl <agent>`\n");

  // Setup: Create mock agent
  const testBin = join(__dirname, "../tmp-bin");
  execSync(`mkdir -p "${testBin}"`, {stdio: "pipe"});
  const mockAgentPath = join(testBin, "mock-agent");
  createMockAgent(mockAgentPath);
  const originalPath = process.env.PATH || "";
  const testPath = `${testBin}:${originalPath}`;
  process.env.PATH = testPath;

  let currentRepo: TestRepo | null = null;

  test("should create worktree and branch", async () => {
    currentRepo = createTestRepo("worktree-test");
    
    // Run git prl mock-agent (non-interactive, just create worktree)
    const result = await runGitPrl(currentRepo.path, ["mock-agent"], {
      env: {SHELL: "/bin/bash", PATH: testPath}
    });

    // Check worktree was created
    if (!worktreeExists(currentRepo.path, "mock-agent")) {
      throw new Error("Worktree directory was not created");
    }

    // Check branch was created
    if (!branchExists(currentRepo.path, "prl/mock-agent")) {
      throw new Error("Branch prl/mock-agent was not created");
    }

    // Check we're on the correct branch in the worktree
    const worktreePath = join(currentRepo.path, ".prl-worktrees", "mock-agent");
    const currentBranch = getCurrentBranch(worktreePath);
    if (currentBranch !== "prl/mock-agent") {
      throw new Error(`Expected branch prl/mock-agent, got ${currentBranch}`);
    }
  });

  test("should copy .env file to worktree", async () => {
    currentRepo = createTestRepo("env-test");
    createTestEnvFile(currentRepo.path, "TEST_VAR=test_value\nAPI_KEY=secret_key_123");
    
    // Run git prl mock-agent
    await runGitPrl(currentRepo.path, ["mock-agent"], {
      env: {SHELL: "/bin/bash", PATH: testPath}
    });

    const worktreePath = join(currentRepo.path, ".prl-worktrees", "mock-agent");
    
    // Check .env file exists in worktree
    if (!fileExists(worktreePath, ".env")) {
      throw new Error(".env file was not copied to worktree");
    }

    // Check .env content matches
    const envContent = readFile(worktreePath, ".env");
    if (!envContent.includes("TEST_VAR=test_value")) {
      throw new Error(".env file content does not match");
    }
    if (!envContent.includes("API_KEY=secret_key_123")) {
      throw new Error(".env file content does not match");
    }
  });

  test("should run npm install in worktree", async () => {
    currentRepo = createTestRepo("npm-test");
    createTestPackageJson(currentRepo.path);
    
    // Run git prl mock-agent
    await runGitPrl(currentRepo.path, ["mock-agent"], {
      env: {SHELL: "/bin/bash", PATH: testPath},
      timeout: 60000 // npm install might take a while
    });

    const worktreePath = join(currentRepo.path, ".prl-worktrees", "mock-agent");
    
    // Check package.json exists in worktree
    if (!fileExists(worktreePath, "package.json")) {
      throw new Error("package.json was not copied to worktree");
    }

    // Check node_modules exists (npm install should have run)
    if (!fileExists(worktreePath, "node_modules")) {
      throw new Error("node_modules directory was not created (npm install may not have run)");
    }

    // Check that the dependency was installed
    if (!fileExists(worktreePath, "node_modules/is-number")) {
      throw new Error("Dependency 'is-number' was not installed");
    }
  });

  test("should create unique branch names on conflict", async () => {
    currentRepo = createTestRepo("conflict-test");
    
    // Create first worktree
    await runGitPrl(currentRepo.path, ["mock-agent"], {
      env: {SHELL: "/bin/bash", PATH: testPath}
    });

    // Create second worktree with same agent name (should auto-increment)
    await runGitPrl(currentRepo.path, ["mock-agent"], {
      env: {SHELL: "/bin/bash", PATH: testPath}
    });

    // Check both branches exist
    if (!branchExists(currentRepo.path, "prl/mock-agent")) {
      throw new Error("First branch prl/mock-agent was not created");
    }
    
    if (!branchExists(currentRepo.path, "prl/mock-agent-1")) {
      throw new Error("Second branch prl/mock-agent-1 was not created (auto-increment failed)");
    }

    // Check both worktrees exist
    if (!worktreeExists(currentRepo.path, "mock-agent")) {
      throw new Error("First worktree was not created");
    }
    
    if (!worktreeExists(currentRepo.path, "mock-agent-1")) {
      throw new Error("Second worktree was not created (auto-increment failed)");
    }
  });

  test("should copy multiple template files", async () => {
    currentRepo = createTestRepo("template-test");
    createTestPackageJson(currentRepo.path);
    createTestEnvFile(currentRepo.path, "ENV_VAR=value");
    
    // Create .gitignore
    const gitignoreContent = "node_modules/\n.env.local\n";
    require("fs").writeFileSync(join(currentRepo.path, ".gitignore"), gitignoreContent);
    
    // Create tsconfig.json
    const tsconfig = {compilerOptions: {target: "ES2020"}};
    require("fs").writeFileSync(join(currentRepo.path, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
    
    await runGitPrl(currentRepo.path, ["mock-agent"], {
      env: {SHELL: "/bin/bash", PATH: testPath}
    });

    const worktreePath = join(currentRepo.path, ".prl-worktrees", "mock-agent");
    
    // Check all template files were copied
    const expectedFiles = [".env", "package.json", ".gitignore", "tsconfig.json"];
    for (const file of expectedFiles) {
      if (!fileExists(worktreePath, file)) {
        throw new Error(`Template file ${file} was not copied to worktree`);
      }
    }
  });

  // Run all tests
  for (const testFn of tests) {
    const result = await testFn();
    if (result.passed) {
      console.log(`✅ ${result.name}`);
      passed++;
    } else {
      console.log(`❌ ${result.name}`);
      console.log(`   Error: ${result.error}`);
      failed++;
    }
    
    // Cleanup after each test
    if (currentRepo !== null) {
      const repoToCleanup: TestRepo = currentRepo;
      repoToCleanup.cleanup();
      currentRepo = null;
    }
  }

  // Restore PATH
  process.env.PATH = originalPath;

  // Summary
  console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch((error) => {
    console.error("Test runner error:", error);
    process.exit(1);
  });
}

export {test, runTests};

