import {execa} from "execa";
import {confirm} from "../utils/prompt";
import {
  describeWorktreeByBranch,
  getRepoRoot,
  listWorktrees,
  removeWorktree
} from "../worktree";

const BASE_BRANCH = "main";

async function checkRemoteAhead(
  root: string,
  baseBranch: string
): Promise<boolean> {
  try {
    // Check if remote tracking branch exists
    let remoteBranch: string;
    try {
      const {stdout} = await execa(
        "git",
        ["rev-parse", "--abbrev-ref", `${baseBranch}@{upstream}`],
        {cwd: root}
      );
      remoteBranch = stdout.trim();
    } catch (error) {
      // No upstream configured, skip remote check
      return false;
    }

    if (!remoteBranch) {
      return false;
    }

    // Fetch to update remote refs (quiet, doesn't modify working tree)
    await execa("git", ["fetch", "--quiet"], {
      cwd: root,
      stdio: "ignore"
    });

    // Check if local is behind remote
    const {stdout: behindCount} = await execa(
      "git",
      ["rev-list", "--count", `${baseBranch}..${remoteBranch}`],
      {cwd: root}
    );

    return parseInt(behindCount.trim(), 10) > 0;
  } catch (error) {
    // If any check fails, assume not ahead (fail gracefully)
    return false;
  }
}

export async function applyAgent(autoCleanup: boolean = false): Promise<void> {
  // Step 1: Validate repository context (reuses existing getRepoRoot)
  // getRepoRoot() will throw with git's error message if not in a repo
  const root = await getRepoRoot();

  // Step 2: Validate current branch context
  // Check HEAD from current working directory (where user is running the command)
  // This will be the prl worktree directory, not the repo root
  let currentBranch: string;
  try {
    const {stdout} = await execa(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      {cwd: process.cwd()}
    );
    currentBranch = stdout.trim();
  } catch (error) {
    throw new Error(
      "Could not determine current branch. Are you in a detached HEAD state?"
    );
  }

  // Step 7: Check if already on base branch (nothing to merge)
  if (currentBranch === BASE_BRANCH) {
    throw new Error(
      `You're already on ${BASE_BRANCH}. Nothing to apply. Run \`git prl apply\` from a prl worktree branch.`
    );
  }

  // Handle detached HEAD state or non-prl branches
  if (currentBranch === "HEAD" || !currentBranch.startsWith("prl/")) {
    throw new Error(
      "`git prl apply` must be run from an active prl worktree branch. Current branch: " +
        (currentBranch === "HEAD" ? "detached HEAD" : currentBranch)
    );
  }

  // Step 3: Locate worktree metadata
  const descriptor = await describeWorktreeByBranch(currentBranch);

  if (!descriptor) {
    // Check if worktree directory exists to provide better error message
    const allWorktrees = await listWorktrees(root);
    const worktreeExists = allWorktrees.some(
      (wt) => wt.branchName === currentBranch
    );

    if (!worktreeExists) {
      throw new Error(
        `Worktree for branch ${currentBranch} was deleted, moved, or renamed. The branch exists but the worktree directory is missing.`
      );
    }

    throw new Error(
      `Could not locate metadata for branch ${currentBranch}. The worktree may have been manually modified.`
    );
  }

  // Step 6: Check if base branch is behind remote (optional, user-configurable)
  // For now, we'll check and warn, but let user decide via --fetch flag in future
  // Git merge will handle diverged branches fine, but user might want to pull first
  const remoteAhead = await checkRemoteAhead(root, BASE_BRANCH);
  if (remoteAhead && process.stdin.isTTY && process.stdout.isTTY) {
    const shouldFetch = await confirm(
      `Local ${BASE_BRANCH} is behind remote. Fetch and update ${BASE_BRANCH} before merging?`
    );
    if (shouldFetch) {
      try {
        // Fetch latest from remote
        await execa("git", ["fetch", "origin", BASE_BRANCH], {
          cwd: root,
          stdio: "inherit"
        });
        // Checkout base branch and merge remote updates
        await execa("git", ["checkout", BASE_BRANCH], {
          cwd: root,
          stdio: "inherit"
        });
        await execa("git", ["merge", `origin/${BASE_BRANCH}`], {
          cwd: root,
          stdio: "inherit"
        });
        // Return to prl branch for the actual apply merge
        await execa("git", ["checkout", currentBranch], {
          cwd: root,
          stdio: "inherit"
        });
        console.log(`Updated local ${BASE_BRANCH} from remote.`);
      } catch (error) {
        console.error(`Failed to update ${BASE_BRANCH} from remote. Continuing with merge anyway.`);
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
  }

  // Step 4: Git will validate base branch exists and handle uncommitted changes
  // when we try to checkout - no need to validate upfront

  // Step 8: Perform merge (always create merge commit with --no-ff)
  // Git will handle merge conflicts natively - we don't try to detect or parse them
  // Git will handle empty merges - we trust git's judgment on whether merge is needed
  try {
    await execa("git", ["checkout", BASE_BRANCH], {
      cwd: root,
      stdio: "inherit"
    });

    // Always create a merge commit (--no-ff) to preserve branch history
    // Git will fail if there are conflicts, empty merges, or other issues
    // We let git handle all merge logic - if git succeeds, merge is good
    await execa("git", ["merge", "--no-ff", currentBranch], {
      cwd: root,
      stdio: "inherit"
    });

    console.log(
      `Merged branch ${currentBranch} into ${BASE_BRANCH}.`
    );

    // Step 10: Prompt for cleanup after successful merge (or auto-cleanup if flag set)
    // Git will warn about uncommitted changes if user tries to delete worktree
    if (autoCleanup) {
      await removeWorktree(descriptor);
      console.log("Worktree removed.");
    } else if (process.stdin.isTTY && process.stdout.isTTY) {
      const shouldCleanup = await confirm(
        `Merge successful. Delete worktree ${descriptor.branchName} and its branch?`
      );
      if (shouldCleanup) {
        await removeWorktree(descriptor);
        console.log("Worktree removed.");
      } else {
        console.log(
          "You can run `git prl prune` later to clean up this worktree."
        );
      }
    } else {
      console.log(
        `Worktree ${descriptor.branchName} remains at ${descriptor.worktreePath}. Run 'git prl prune' when ready.`
      );
    }
  } catch (error) {
    // Step 9: Git handles conflict detection and reporting natively
    // If user resolves conflicts but doesn't commit, git will prevent checkout/merge
    // We don't try to detect conflict state - we trust git's commands
    console.error(
      "Merge encountered conflicts or failed. Resolve them and rerun `git prl apply`."
    );
    throw error;
  }

  // Step 11: If we reach here, merge succeeded (git merge would have thrown otherwise)
  // No need to verify merge success - if git merge succeeds, the merge is valid
  // Edge case: prl branch being ancestor of base branch is handled by git
  // (git will create merge commit or handle as appropriate)
}

