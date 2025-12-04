import {execSync} from "child_process";
import {existsSync, readFileSync, writeFileSync} from "fs";
import {join} from "path";
import {
  createTestRepo,
  createMockAgent,
  runGitPrl,
  type TestRepo
} from "./setup";

// Test specifically for agent launch behavior
async function testAgentLaunch() {
  console.log("🧪 Testing agent launch behavior\n");

  // Setup: Create mock agent that writes to a file
  const testBin = join(__dirname, "../tmp-bin");
  execSync(`mkdir -p "${testBin}"`, {stdio: "pipe"});
  const mockAgentPath = join(testBin, "mock-agent");
  
  // Create a mock agent that writes to a file to prove it ran
  const agentScript = `#!/bin/bash
# Mock agent that writes to a file to prove it executed
OUTPUT_FILE="${process.env.PRL_WORKTREE_PATH || process.cwd()}/.agent-ran.txt"
echo "Agent executed at $(date)" > "$OUTPUT_FILE"
echo "Mock agent running..."
exit 0
`;
  writeFileSync(mockAgentPath, agentScript, {mode: 0o755});
  
  const originalPath = process.env.PATH || "";
  const testPath = `${testBin}:${originalPath}`;
  process.env.PATH = testPath;

  const repo = createTestRepo("agent-launch-test");
  
  try {
    console.log("Test 1: git prl mock-agent (no worktree name, no agent args)");
    await runGitPrl(repo.path, ["mock-agent"], {
      env: {SHELL: "/bin/bash", PATH: testPath}
    });

    const worktreePath1 = join(repo.path, ".prl-worktrees", "mock-agent");
    const agentRanFile1 = join(worktreePath1, ".agent-ran.txt");
    
    if (!existsSync(agentRanFile1)) {
      console.log("❌ Agent did NOT run when called with: git prl mock-agent");
      console.log(`   Expected file: ${agentRanFile1}`);
      process.exit(1);
    } else {
      const content = readFileSync(agentRanFile1, "utf-8");
      console.log(`✅ Agent ran successfully`);
      console.log(`   Agent output: ${content.trim()}`);
    }

    // Clean up first worktree
    execSync(`rm -rf "${worktreePath1}"`, {stdio: "pipe"});
    try {
      execSync("git branch -D prl/mock-agent", {cwd: repo.path, stdio: "pipe"});
    } catch {
      // Ignore if branch doesn't exist
    }

    console.log("\nTest 2: git prl -w testworktree mock-agent (with worktree name, no agent args)");
    await runGitPrl(repo.path, ["-w", "testworktree", "mock-agent"], {
      env: {SHELL: "/bin/bash", PATH: testPath}
    });

    const worktreePath2 = join(repo.path, ".prl-worktrees", "testworktree");
    const agentRanFile2 = join(worktreePath2, ".agent-ran.txt");
    
    if (!existsSync(agentRanFile2)) {
      console.log("❌ Agent did NOT run when called with: git prl -w testworktree mock-agent");
      console.log(`   Expected file: ${agentRanFile2}`);
      process.exit(1);
    } else {
      const content = readFileSync(agentRanFile2, "utf-8");
      console.log(`✅ Agent ran successfully with -w flag`);
      console.log(`   Agent output: ${content.trim()}`);
    }

    console.log("\n✅ All agent launch tests passed!");
    
  } finally {
    repo.cleanup();
    process.env.PATH = originalPath;
  }
}

if (require.main === module) {
  testAgentLaunch().catch((error) => {
    console.error("Test error:", error);
    process.exit(1);
  });
}

