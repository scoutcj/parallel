import {execa} from "execa";
import {confirm} from "../utils/prompt";
import {getScriptPath} from "../utils/scripts";

interface WorktreeInfo {
  worktreeName: string;
  branchName: string;
  worktreePath: string;
}

/**
 * Parse structured output from prl-prune.sh
 */
function parsePruneOutput(stderr: string): WorktreeInfo[] {
  const lines = stderr.split("\n");
  const worktrees: WorktreeInfo[] = [];
  let inPruneSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === "PRUNE_WORKTREES_START") {
      inPruneSection = true;
      continue;
    }
    
    if (trimmed === "PRUNE_WORKTREES_END") {
      break;
    }
    
    if (inPruneSection && trimmed) {
      const [worktreeName, branchName, worktreePath] = trimmed.split("|");
      if (worktreeName && branchName && worktreePath) {
        worktrees.push({worktreeName, branchName, worktreePath});
      }
    }
  }

  return worktrees;
}

async function removeWorktree(
  root: string,
  worktreePath: string,
  branchName: string
): Promise<void> {
  try {
    await execa("git", ["worktree", "remove", "--force", worktreePath], {
      cwd: root,
      stdio: "ignore"
    });
  } catch (error) {
    // continue even if removal fails, to attempt branch cleanup
  }

  try {
    await execa("git", ["branch", "-D", branchName], {
      cwd: root,
      stdio: "ignore"
    });
  } catch (error) {
    // ignore missing branch
  }
}

export async function pruneWorktrees(): Promise<void> {
  const scriptPath = getScriptPath("prl-prune.sh");
  
  // Run bash script to get list of worktrees
  const result = await execa("bash", [scriptPath], {
    stdio: ["inherit", "inherit", "pipe"] // stderr has structured output
  });

  const worktrees = parsePruneOutput(result.stderr);

  if (worktrees.length === 0) {
    console.log("No prl worktrees to prune.");
    return;
  }

  // Get repo root from first worktree (they all share the same root)
  const root = worktrees[0].worktreePath.split("/.prl-worktrees/")[0];
  if (!root) {
    throw new Error("Failed to determine repository root");
  }

  for (const worktree of worktrees) {
    const prompt = `Prune worktree ${worktree.branchName} at ${worktree.worktreePath}?`;
    const shouldRemove =
      process.stdin.isTTY && process.stdout.isTTY
        ? await confirm(prompt)
        : false;

    if (shouldRemove) {
      await removeWorktree(root, worktree.worktreePath, worktree.branchName);
      console.log(`Removed ${worktree.branchName}.`);
    } else {
      console.log(`Skipping ${worktree.branchName}.`);
    }
  }
}
