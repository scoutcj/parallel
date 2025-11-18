import {execa} from "execa";
import {confirm} from "../utils/prompt";
import {
  createWorktree,
  removeWorktree,
  WorktreeDescriptor
} from "../worktree";

interface StartOptions {
  suffix?: string;
}

function resolveShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC ?? "cmd.exe";
  }
  return process.env.SHELL ?? "/bin/bash";
}

async function openShell(descriptor: WorktreeDescriptor): Promise<void> {
  const shell = resolveShell();
  await execa(shell, [], {
    cwd: descriptor.worktreePath,
    stdio: "inherit"
  });
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
  const descriptor = await createWorktree(agentName, options.suffix);
  console.log(
    `Worktree ${descriptor.worktreeName} is ready at ${descriptor.worktreePath}.`
  );

  try {
    await openShell(descriptor);
  } finally {
    await askToPrune(descriptor);
  }
}

