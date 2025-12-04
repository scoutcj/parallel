import {execa} from "execa";
import {confirm} from "../utils/prompt";
import {getScriptPath} from "../utils/scripts";
import {WorktreeDescriptor} from "../worktree";

interface StartOptions {
  worktreeName?: string;
  agentArgs?: string[];
}

/**
 * Parse structured output from prl-start.sh (from stderr)
 */
function parseStartOutput(stderr: string): {
  descriptor: WorktreeDescriptor;
  agentRan: boolean;
} {
  const lines = stderr.split("\n");
  let inWorktreeInfo = false;
  const info: Partial<WorktreeDescriptor> = {};
  let agentRan = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line === "WORKTREE_INFO_START") {
      inWorktreeInfo = true;
      continue;
    }
    
    if (line === "WORKTREE_INFO_END") {
      inWorktreeInfo = false;
      continue;
    }
    
    if (line.startsWith("SHELL_READY")) {
      agentRan = true;
      // Also parse WORKTREE_PATH from this line if present
      const worktreeMatch = line.match(/WORKTREE_PATH=(.+)/);
      if (worktreeMatch && !info.worktreePath) {
        info.worktreePath = worktreeMatch[1];
      }
      continue;
    }
    
    if (inWorktreeInfo) {
      const [key, ...valueParts] = line.split("=");
      const value = valueParts.join("="); // Handle values with = in them
      if (key === "AGENT") info.agent = value;
      if (key === "WORKTREE_NAME") info.worktreeName = value;
      if (key === "BRANCH_NAME") info.branchName = value;
      if (key === "WORKTREE_PATH") info.worktreePath = value;
      if (key === "ROOT") info.root = value;
    }
  }

  if (!info.agent || !info.worktreeName || !info.branchName || !info.worktreePath || !info.root) {
    throw new Error("Failed to parse worktree info from bash script output");
  }

  return {
    descriptor: info as WorktreeDescriptor,
    agentRan
  };
}

function getShellPath(): string {
  return process.env.SHELL ?? "/bin/bash";
}

function getShellArgs(): string[] {
  return ["-i"];
}

async function openWorktreeShell(
  descriptor: WorktreeDescriptor
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(
      "Worktree shell skipped because this session is not attached to a terminal."
    );
    return;
  }

  const shellPath = getShellPath();
  const shellArgs = getShellArgs();
  console.log(
    `Dropping you into an interactive ${shellPath} shell inside ${descriptor.worktreePath}.`
  );

  const result = await execa(shellPath, shellArgs, {
    cwd: descriptor.worktreePath,
    stdio: "inherit",
    env: {
      ...process.env,
      PRL_WORKTREE_PATH: descriptor.worktreePath
    },
    reject: false
  });

  if (result.signal) {
    console.log(`Shell exited due to signal ${result.signal}.`);
  } else if (result.exitCode && result.exitCode !== 0) {
    console.log(`Shell exited with code ${result.exitCode}.`);
  }
}

async function removeWorktree(descriptor: WorktreeDescriptor): Promise<void> {
  const scriptPath = getScriptPath("prl-common.sh");
  // We'll use a simple git command approach for cleanup
  try {
    await execa("git", ["worktree", "remove", "--force", descriptor.worktreePath], {
      cwd: descriptor.root,
      stdio: "ignore"
    });
  } catch (error) {
    // continue even if removal fails, to attempt branch cleanup
  }

  try {
    await execa("git", ["branch", "-D", descriptor.branchName], {
      cwd: descriptor.root,
      stdio: "ignore"
    });
  } catch (error) {
    // ignore missing branch
  }
}

async function askToPrune(descriptor: WorktreeDescriptor): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.log(
      `Worktree ${descriptor.branchName} remains at ${descriptor.worktreePath}. Run \`git prl prune\` when ready.`
    );
    return;
  }

  const shouldRemove = await confirm(
    `Delete branch ${descriptor.branchName} and its worktree?`
  );
  if (shouldRemove) {
    await removeWorktree(descriptor);
    console.log("Worktree removed.");
  } else {
    console.log(
      "You can run `git prl prune` later to clean up this worktree."
    );
  }
}

export async function startAgent(
  agentName: string,
  options: StartOptions
): Promise<void> {
  const scriptPath = getScriptPath("prl-start.sh");
  
  // Build arguments for bash script
  const scriptArgs: string[] = [agentName];
  if (options.worktreeName) {
    scriptArgs.push(options.worktreeName);
  } else {
    scriptArgs.push(""); // Empty string for no explicit worktree name
  }
  // Add agent args
  if (options.agentArgs && options.agentArgs.length > 0) {
    scriptArgs.push(...options.agentArgs);
  }

  // Run bash script
  // Structured output goes to stderr, agent output goes to stdout (inherited)
  const result = await execa("bash", [scriptPath, ...scriptArgs], {
    stdio: ["inherit", "inherit", "pipe"], // stdin: inherit, stdout: inherit, stderr: pipe
    reject: false
  });

  // Parse structured output from stderr
  const {descriptor, agentRan} = parseStartOutput(result.stderr);
  
  console.log(
    `Worktree ${descriptor.worktreeName} is ready at ${descriptor.worktreePath}.`
  );

  try {
    // Open interactive shell (bash script already ran agent if args were provided)
    await openWorktreeShell(descriptor);
  } finally {
    await askToPrune(descriptor);
  }
}
