import {execa} from "execa";
import {
  describeWorktreeByBranch,
  getRepoRoot
} from "../worktree";

const BASE_BRANCH = "main";

export async function applyAgent(): Promise<void> {
  const root = await getRepoRoot();
  const {stdout: currentBranch} = await execa(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    {
      cwd: root
    }
  );

  if (!currentBranch.startsWith("prl/")) {
    throw new Error(
      "`git prl apply` must be run from an active prl worktree branch."
    );
  }

  const descriptor = await describeWorktreeByBranch(currentBranch);

  if (!descriptor) {
    throw new Error(
      `Could not locate metadata for branch ${currentBranch}.`
    );
  }

  try {
    await execa("git", ["checkout", BASE_BRANCH], {
      cwd: root,
      stdio: "inherit"
    });

    await execa("git", ["merge", "--no-ff", currentBranch], {
      cwd: root,
      stdio: "inherit"
    });

    console.log(
      `Merged branch ${currentBranch} into ${BASE_BRANCH}.`
    );
    console.log(
      "Run `git prl prune` when you are ready to delete the agent worktree."
    );
  } catch (error) {
    console.error(
      "Merge encountered conflicts or failed. Resolve them and rerun `git prl apply`."
    );
    throw error;
  }
}

