import {listWorktrees} from "../worktree";

export async function listAgents(): Promise<void> {
  const worktrees = await listWorktrees();

  if (!worktrees.length) {
    console.log("No active prl worktrees were found.");
    return;
  }

  console.log("Active prl worktrees:");
  worktrees.forEach((descriptor) => {
    console.log(`- ${descriptor.branchName} (${descriptor.worktreePath})`);
  });
}

