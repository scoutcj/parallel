import {execa} from "execa";
import {confirm} from "../utils/prompt";
import {getScriptPath} from "../utils/scripts";

const BASE_BRANCH = "main";

interface ApplyOutput {
  remoteAhead: boolean;
  remoteBranch?: string;
  baseBranch: string;
  currentBranch: string;
  worktreeName: string;
  worktreePath: string;
  branchName: string;
  autoCleanup: boolean;
}

/**
 * Parse structured output from prl-apply.sh (REMOTE_CHECK section)
 */
function parseApplyOutput(stderr: string): ApplyOutput {
  const lines = stderr.split("\n");
  let inRemoteCheck = false;
  const info: Partial<ApplyOutput> = {
    baseBranch: BASE_BRANCH,
    autoCleanup: false,
    remoteAhead: false
  };

  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === "REMOTE_CHECK_START") {
      inRemoteCheck = true;
      continue;
    }
    
    if (trimmed === "REMOTE_CHECK_END") {
      break;
    }
    
    if (inRemoteCheck) {
      const [key, value] = trimmed.split("=", 2);
      if (key === "REMOTE_AHEAD") info.remoteAhead = value === "true";
      if (key === "REMOTE_BRANCH") info.remoteBranch = value || undefined;
      if (key === "BASE_BRANCH") info.baseBranch = value || BASE_BRANCH;
      if (key === "CURRENT_BRANCH") info.currentBranch = value;
      if (key === "WORKTREE_NAME") info.worktreeName = value;
      if (key === "WORKTREE_PATH") info.worktreePath = value;
      if (key === "BRANCH_NAME") info.branchName = value;
      if (key === "AUTO_CLEANUP") info.autoCleanup = value === "true";
    }
  }

  if (!info.currentBranch || !info.worktreeName || !info.worktreePath || !info.branchName) {
    throw new Error("Failed to parse apply info from bash script output");
  }

  return info as ApplyOutput;
}

/**
 * Parse merge success output from prl-apply-merge.sh (MERGE_SUCCESS section)
 */
function parseMergeOutput(stderr: string): Partial<ApplyOutput> {
  const lines = stderr.split("\n");
  let inMergeSuccess = false;
  const info: Partial<ApplyOutput> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === "MERGE_SUCCESS_START") {
      inMergeSuccess = true;
      continue;
    }
    
    if (trimmed === "MERGE_SUCCESS_END") {
      break;
    }
    
    if (inMergeSuccess) {
      const [key, value] = trimmed.split("=", 2);
      if (key === "WORKTREE_NAME") info.worktreeName = value;
      if (key === "BRANCH_NAME") info.branchName = value;
      if (key === "WORKTREE_PATH") info.worktreePath = value;
    }
  }

  return info;
}

async function updateBaseBranchFromRemote(
  root: string,
  baseBranch: string,
  remoteBranch: string,
  currentBranch: string
): Promise<void> {
  try {
    // Fetch latest from remote
    await execa("git", ["fetch", "origin", baseBranch], {
      cwd: root,
      stdio: "inherit"
    });
    
    // Checkout base branch and merge remote updates
    await execa("git", ["checkout", baseBranch], {
      cwd: root,
      stdio: "inherit"
    });
    
    await execa("git", ["merge", remoteBranch], {
      cwd: root,
      stdio: "inherit"
    });
    
    // Return to prl branch for the actual apply merge
    await execa("git", ["checkout", currentBranch], {
      cwd: root,
      stdio: "inherit"
    });
    
    console.log(`Updated local ${baseBranch} from remote.`);
  } catch (error) {
    console.error(`Failed to update ${baseBranch} from remote. Continuing with merge anyway.`);
    // Try to return to prl branch if we're stuck on main
    try {
      await execa("git", ["checkout", currentBranch], {
        cwd: root,
        stdio: "ignore"
      });
    } catch {
      // Ignore - we'll handle checkout in the main try block
    }
  }
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

export async function applyAgent(autoCleanup: boolean = false): Promise<void> {
  const scriptPath = getScriptPath("prl-apply.sh");
  
  // Run bash script to check remote status and get worktree info
  const result = await execa("bash", [scriptPath, BASE_BRANCH, String(autoCleanup)], {
    stdio: ["inherit", "inherit", "pipe"] // stderr has structured output
  });

  const info = parseApplyOutput(result.stderr);

  // Check if base branch is behind remote
  if (info.remoteAhead && info.remoteBranch && process.stdin.isTTY && process.stdout.isTTY) {
    const shouldFetch = await confirm(
      `Local ${info.baseBranch} is behind remote. Fetch and update ${info.baseBranch} before merging?`
    );
    if (shouldFetch) {
      const root = info.worktreePath.split("/.prl-worktrees/")[0];
      if (!root) {
        throw new Error("Failed to determine repository root");
      }
      await updateBaseBranchFromRemote(root, info.baseBranch, info.remoteBranch, info.currentBranch);
    }
  }

  // Perform the merge using the merge script
  const mergeScriptPath = getScriptPath("prl-apply-merge.sh");
  try {
    const mergeResult = await execa("bash", [mergeScriptPath, info.baseBranch, info.currentBranch], {
      stdio: ["inherit", "inherit", "pipe"] // stderr has structured output
    });
    
    // Parse merge success info (if needed for cleanup)
    const mergeInfo = parseMergeOutput(mergeResult.stderr);
    if (mergeInfo.worktreePath) {
      info.worktreePath = mergeInfo.worktreePath;
    }
    if (mergeInfo.worktreeName) {
      info.worktreeName = mergeInfo.worktreeName;
    }
    if (mergeInfo.branchName) {
      info.branchName = mergeInfo.branchName;
    }
  } catch (error) {
    console.error(
      "Merge encountered conflicts or failed. Resolve them and rerun `git prl apply`."
    );
    throw error;
  }

  // Handle cleanup
  const root = info.worktreePath.split("/.prl-worktrees/")[0];
  if (!root) {
    throw new Error("Failed to determine repository root");
  }

  if (autoCleanup) {
    await removeWorktree(root, info.worktreePath, info.branchName);
    console.log("Worktree removed.");
  } else if (process.stdin.isTTY && process.stdout.isTTY) {
    const shouldCleanup = await confirm(
      `Merge successful. Delete worktree ${info.branchName} and its branch?`
    );
    if (shouldCleanup) {
      await removeWorktree(root, info.worktreePath, info.branchName);
      console.log("Worktree removed.");
    } else {
      console.log(
        "You can run `git prl prune` later to clean up this worktree."
      );
    }
  } else {
    console.log(
      `Worktree ${info.branchName} remains at ${info.worktreePath}. Run 'git prl prune' when ready.`
    );
  }
}
