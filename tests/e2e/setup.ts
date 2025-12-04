import {execSync} from "child_process";
import {mkdirSync, rmSync, writeFileSync, existsSync, readFileSync} from "fs";
import {join} from "path";
import {tmpdir} from "os";

export interface TestRepo {
  path: string;
  cleanup: () => void;
}

/**
 * Create an isolated git repository for testing
 */
export function createTestRepo(name: string): TestRepo {
  const repoPath = join(tmpdir(), `git-prl-test-${name}-${Date.now()}-${Math.random().toString(36).substring(7)}`);
  mkdirSync(repoPath, {recursive: true});
  
  // Initialize git repo
  execSync("git init", {cwd: repoPath, stdio: "pipe"});
  execSync("git config user.name 'Test User'", {cwd: repoPath, stdio: "pipe"});
  execSync("git config user.email 'test@example.com'", {cwd: repoPath, stdio: "pipe"});
  
  // Create initial commit
  writeFileSync(join(repoPath, "README.md"), "# Test Repo\n");
  execSync("git add README.md", {cwd: repoPath, stdio: "pipe"});
  execSync("git commit -m 'Initial commit'", {cwd: repoPath, stdio: "pipe"});
  execSync("git branch -M main", {cwd: repoPath, stdio: "pipe"});
  
  return {
    path: repoPath,
    cleanup: () => {
      try {
        rmSync(repoPath, {recursive: true, force: true});
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  };
}

/**
 * Create a mock agent command that can be used for testing
 */
export function createMockAgent(agentPath: string): void {
  const agentScript = `#!/bin/bash
# Mock agent for testing
# Just exits successfully - we're testing the worktree setup, not the agent itself
echo "Mock agent executed in: $(pwd)"
exit 0
`;
  writeFileSync(agentPath, agentScript, {mode: 0o755});
}

/**
 * Create a test package.json for npm install testing
 */
export function createTestPackageJson(repoPath: string): void {
  const packageJson = {
    name: "test-project",
    version: "1.0.0",
    description: "Test project for git-prl",
    dependencies: {
      // Use a small, fast package for testing
      "is-number": "^7.0.0"
    }
  };
  writeFileSync(join(repoPath, "package.json"), JSON.stringify(packageJson, null, 2));
}

/**
 * Create a test .env file
 */
export function createTestEnvFile(repoPath: string, content: string = "TEST_VAR=test_value\nAPI_KEY=test_key_123"): void {
  writeFileSync(join(repoPath, ".env"), content);
}

/**
 * Get the path to the git-prl binary
 */
export function getGitPrlPath(): string {
  return join(__dirname, "../../bin/prl.js");
}

/**
 * Run git-prl command and return output
 * In non-TTY environments, the shell will be skipped automatically
 */
export function runGitPrl(repoPath: string, args: string[], options: {env?: Record<string, string>, input?: string, timeout?: number} = {}): Promise<{stdout: string, stderr: string, exitCode: number}> {
  const gitPrlPath = getGitPrlPath();
  const {spawn} = require("child_process");
  
  return new Promise((resolve) => {
    // Ensure we're in non-TTY mode so shell is skipped
    const env = {
      ...process.env,
      ...options.env,
      CI: "true"
    };
    
    const proc = spawn("node", [gitPrlPath, ...args], {
      cwd: repoPath,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    
    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    
    proc.on("close", (code: number) => {
      resolve({
        stdout,
        stderr,
        exitCode: code || 0
      });
    });
    
    // In non-TTY mode, the cleanup prompt is automatically skipped
    // So we just close stdin
    if (options.input) {
      proc.stdin.write(options.input);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }
    
    // Timeout after specified time (default 30 seconds)
    const timeout = setTimeout(() => {
      if (!proc.killed) {
        proc.kill("SIGTERM");
        resolve({
          stdout,
          stderr: stderr + "\n[Test timeout]",
          exitCode: 124
        });
      }
    }, options.timeout || 30000);
    
    proc.on("close", () => {
      clearTimeout(timeout);
    });
  });
}

/**
 * Check if a worktree exists
 */
export function worktreeExists(repoPath: string, worktreeName: string): boolean {
  const worktreePath = join(repoPath, ".prl-worktrees", worktreeName);
  return existsSync(worktreePath);
}

/**
 * Check if a branch exists
 */
export function branchExists(repoPath: string, branchName: string): boolean {
  try {
    const branches = execSync("git branch", {cwd: repoPath, encoding: "utf-8"});
    return branches.includes(branchName);
  } catch {
    return false;
  }
}

/**
 * Get the current branch in a directory
 */
export function getCurrentBranch(path: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {cwd: path, encoding: "utf-8"}).trim();
  } catch {
    return "";
  }
}

/**
 * Check if a file exists in a directory
 */
export function fileExists(dir: string, filename: string): boolean {
  return existsSync(join(dir, filename));
}

/**
 * Read file content
 */
export function readFile(dir: string, filename: string): string {
  return readFileSync(join(dir, filename), "utf-8");
}

