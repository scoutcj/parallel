import {execa} from "execa";
import {confirm} from "../utils/prompt";
import {
  createWorktree,
  removeWorktree,
  WorktreeDescriptor
} from "../worktree";

interface StartOptions {
  worktreeName?: string;
  agentArgs?: string[];
}

async function validateAgentCommand(agentName: string): Promise<void> {
  try {
    // Use 'command -v' (Unix) to check if command exists in PATH
    await execa("command", ["-v", agentName]);
  } catch (error) {
    throw new Error(
      `${agentName} is not a command that can launch an agent. Is it installed and in your PATH?`
    );
  }
}

async function runAgentCommand(
  descriptor: WorktreeDescriptor,
  agentName: string,
  agentArgs: string[] = []
): Promise<void> {
  console.log(`Running agent command: ${agentName}${agentArgs.length > 0 ? ` ${agentArgs.join(" ")}` : ""}`);

  try {
    await execa(agentName, agentArgs, {
      cwd: descriptor.worktreePath,
      stdio: "inherit"
    });
  } catch (error) {
    console.error(
      `Agent command ${agentName} failed; you can recover inside ${descriptor.worktreePath}.`
    );
  }
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
  // Validate agent command exists before creating worktree
  await validateAgentCommand(agentName);

  const descriptor = await createWorktree(agentName, {
    worktreeName: options.worktreeName
  });
  console.log(
    `Worktree ${descriptor.worktreeName} is ready at ${descriptor.worktreePath}.`
  );

  try {
    await runAgentCommand(descriptor, agentName, options.agentArgs);
    await openWorktreeShell(descriptor);
  } finally {
    await askToPrune(descriptor);
  }
}

