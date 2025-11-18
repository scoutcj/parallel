import {confirm} from "../utils/prompt";
import {listWorktrees, removeWorktree} from "../worktree";

export async function pruneWorktrees(): Promise<void> {
  const worktrees = await listWorktrees();

  if (!worktrees.length) {
    console.log("No prl worktrees to prune.");
    return;
  }

  for (const descriptor of worktrees) {
    const prompt = `Prune worktree ${descriptor.branchName} at ${descriptor.worktreePath}?`;
    const shouldRemove =
      process.stdin.isTTY && process.stdout.isTTY
        ? await confirm(prompt)
        : false;

    if (shouldRemove) {
      await removeWorktree(descriptor);
      console.log(`Removed ${descriptor.branchName}.`);
    } else {
      console.log(`Skipping ${descriptor.branchName}.`);
    }
  }
}

