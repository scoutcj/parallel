import {execSync} from "child_process";
import {existsSync, readFileSync, writeFileSync} from "fs";
import {join} from "path";
import {
  createTestRepo,
  createMockAgent,
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
  console.log("🧪 Running E2E tests for `git prl apply`\n");

  // Setup: Create mock agent
  const testBin = join(__dirname, "../tmp-bin");
  execSync(`mkdir -p "${testBin}"`, {stdio: "pipe"});
  const mockAgentPath = join(testBin, "mock-agent");
  createMockAgent(mockAgentPath);
  const originalPath = process.env.PATH || "";
  const testPath = `${testBin}:${originalPath}`;
  process.env.PATH = testPath;

  let currentRepo: TestRepo | null = null;

  test("should successfully merge prl branch into main", async () => {
    currentRepo = createTestRepo("apply-success");
    
    // Create a worktree with mock-agent
    await runGitPrl(currentRepo.path, ["mock-agent"], {
      env: {SHELL: "/bin/bash", PATH: testPath}
    });

    const worktreePath = join(currentRepo.path, ".prl-worktrees", "mock-agent");
    
    // Make a change in the worktree
    writeFileSync(join(worktreePath, "feature.txt"), "New feature from agent");
    execSync("git add feature.txt", {cwd: worktreePath, stdio: "pipe"});
    execSync("git commit -m 'Add feature'", {cwd: worktreePath, stdio: "pipe"});

    // Run apply from the worktree
    const result = await runGitPrl(worktreePath, ["apply"], {
      env: {SHELL: "/bin/bash", PATH: testPath},
      input: "n\n" // Answer "no" to cleanup prompt
    });

    // Check that merge succeeded (exit code 0)
    if (result.exitCode !== 0) {
      throw new Error(`Apply failed with exit code ${result.exitCode}. stderr: ${result.stderr}`);
    }

    // Verify file exists in main branch
    execSync("git checkout main", {cwd: currentRepo.path, stdio: "pipe"});
    if (!fileExists(currentRepo.path, "feature.txt")) {
      throw new Error("feature.txt was not merged into main");
    }

    // Verify file content
    const content = readFile(currentRepo.path, "feature.txt");
    if (content.trim() !== "New feature from agent") {
      throw new Error(`Expected "New feature from agent", got "${content.trim()}"`);
    }

    // Verify merge commit was created
    const log = execSync("git log --oneline -1", {cwd: currentRepo.path, encoding: "utf-8"});
    if (!log.includes("Merge branch")) {
      throw new Error("Merge commit was not created");
    }
  });

  test("should handle merge conflicts gracefully", async () => {
    currentRepo = createTestRepo("apply-conflict");
    
    // Create a worktree
    await runGitPrl(currentRepo.path, ["mock-agent"], {
      env: {SHELL: "/bin/bash", PATH: testPath}
    });

    const worktreePath = join(currentRepo.path, ".prl-worktrees", "mock-agent");
    
    // Make conflicting change in worktree
    writeFileSync(join(worktreePath, "README.md"), "# Conflicting Change from Agent\n");
    execSync("git add README.md", {cwd: worktreePath, stdio: "pipe"});
    execSync("git commit -m 'Agent change'", {cwd: worktreePath, stdio: "pipe"});

    // Make different change in main
    writeFileSync(join(currentRepo.path, "README.md"), "# Main Change\n");
    execSync("git add README.md", {cwd: currentRepo.path, stdio: "pipe"});
    execSync("git commit -m 'Main change'", {cwd: currentRepo.path, stdio: "pipe"});

    // Try to apply - should fail with conflict
    const result = await runGitPrl(worktreePath, ["apply"], {
      env: {SHELL: "/bin/bash", PATH: testPath}
    });

    // Should fail with non-zero exit code
    if (result.exitCode === 0) {
      throw new Error("Apply should have failed due to merge conflict, but succeeded");
    }

    // Should mention conflicts in output
    if (!result.stderr.includes("conflict") && !result.stdout.includes("conflict")) {
      // Check if we're on main with merge in progress
      const currentBranch = getCurrentBranch(currentRepo.path);
      if (currentBranch !== "main") {
        throw new Error("Expected to be on main after failed merge");
      }
      
      // Check for merge conflict markers
      const readmeContent = readFile(currentRepo.path, "README.md");
      if (!readmeContent.includes("<<<<<<<") && !readmeContent.includes("=======")) {
        throw new Error("Merge conflict markers not found in README.md");
      }
    }
  });

  test("should fail if not in prl branch", async () => {
    currentRepo = createTestRepo("apply-not-prl");
    
    // Try to apply from main branch (not a prl branch)
    const result = await runGitPrl(currentRepo.path, ["apply"], {
      env: {SHELL: "/bin/bash", PATH: testPath}
    });

    // Should fail with error
    if (result.exitCode === 0) {
      throw new Error("Apply should have failed when not in prl branch");
    }

    // Should mention the error
    if (!result.stderr.includes("prl") && !result.stdout.includes("prl")) {
      throw new Error("Error message should mention prl branch requirement");
    }
  });

  test("should fail if already on main branch", async () => {
    currentRepo = createTestRepo("apply-on-main");
    
    // Create a worktree first
    await runGitPrl(currentRepo.path, ["mock-agent"], {
      env: {SHELL: "/bin/bash", PATH: testPath}
    });

    // Try to apply from main branch
    const result = await runGitPrl(currentRepo.path, ["apply"], {
      env: {SHELL: "/bin/bash", PATH: testPath}
    });

    // Should fail with error
    if (result.exitCode === 0) {
      throw new Error("Apply should have failed when already on main");
    }

    // Should mention the error
    if (!result.stderr.includes("main") && !result.stdout.includes("main")) {
      throw new Error("Error message should mention main branch");
    }
  });

  test("should preserve worktree after successful merge (no cleanup)", async () => {
    currentRepo = createTestRepo("apply-no-cleanup");
    
    // Create a worktree
    await runGitPrl(currentRepo.path, ["mock-agent"], {
      env: {SHELL: "/bin/bash", PATH: testPath}
    });

    const worktreePath = join(currentRepo.path, ".prl-worktrees", "mock-agent");
    
    // Make a change and commit
    writeFileSync(join(worktreePath, "test.txt"), "test");
    execSync("git add test.txt", {cwd: worktreePath, stdio: "pipe"});
    execSync("git commit -m 'test'", {cwd: worktreePath, stdio: "pipe"});

    // Apply with "no" to cleanup (non-interactive, so it should skip cleanup)
    const result = await runGitPrl(worktreePath, ["apply"], {
      env: {SHELL: "/bin/bash", PATH: testPath},
      input: "n\n"
    });

    if (result.exitCode !== 0) {
      throw new Error(`Apply failed: ${result.stderr}`);
    }

    // Worktree should still exist
    if (!worktreeExists(currentRepo.path, "mock-agent")) {
      throw new Error("Worktree should still exist after apply (no cleanup)");
    }

    // Branch should still exist
    if (!branchExists(currentRepo.path, "prl/mock-agent")) {
      throw new Error("Branch should still exist after apply (no cleanup)");
    }
  });

  test("should merge multiple commits from prl branch", async () => {
    currentRepo = createTestRepo("apply-multiple");
    
    // Create a worktree
    await runGitPrl(currentRepo.path, ["mock-agent"], {
      env: {SHELL: "/bin/bash", PATH: testPath}
    });

    const worktreePath = join(currentRepo.path, ".prl-worktrees", "mock-agent");
    
    // Make multiple commits
    writeFileSync(join(worktreePath, "file1.txt"), "file1");
    execSync("git add file1.txt", {cwd: worktreePath, stdio: "pipe"});
    execSync("git commit -m 'Commit 1'", {cwd: worktreePath, stdio: "pipe"});

    writeFileSync(join(worktreePath, "file2.txt"), "file2");
    execSync("git add file2.txt", {cwd: worktreePath, stdio: "pipe"});
    execSync("git commit -m 'Commit 2'", {cwd: worktreePath, stdio: "pipe"});

    // Apply
    const result = await runGitPrl(worktreePath, ["apply"], {
      env: {SHELL: "/bin/bash", PATH: testPath},
      input: "n\n"
    });

    if (result.exitCode !== 0) {
      throw new Error(`Apply failed: ${result.stderr}`);
    }

    // Check both files are in main
    execSync("git checkout main", {cwd: currentRepo.path, stdio: "pipe"});
    if (!fileExists(currentRepo.path, "file1.txt")) {
      throw new Error("file1.txt was not merged");
    }
    if (!fileExists(currentRepo.path, "file2.txt")) {
      throw new Error("file2.txt was not merged");
    }

    // Verify both commits are in the history (via merge commit)
    const log = execSync("git log --oneline -5", {cwd: currentRepo.path, encoding: "utf-8"});
    if (!log.includes("Commit 1") || !log.includes("Commit 2")) {
      throw new Error("Commits from prl branch are not in main history");
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

