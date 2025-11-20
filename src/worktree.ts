import {execa} from "execa";
import {mkdirSync, existsSync} from "fs";
import {promises as fsPromises} from "fs";
import {join, dirname, resolve} from "path";

const {readdir} = fsPromises;

const PRL_WORKTREES_DIR = ".prl-worktrees";

export interface WorktreeDescriptor {
  agent: string;
  branchName: string;
  worktreeName: string;
  worktreePath: string;
  root: string;
}

export interface CreateWorktreeOptions {
  worktreeName?: string;
}

export async function getRepoRoot(): Promise<string> {
  // Use --git-common-dir to get the actual repository root, even when inside a worktree
  // This returns the .git directory (or common git dir for worktrees)
  // The repository root is the parent of this directory
  const {stdout: gitCommonDir} = await execa("git", ["rev-parse", "--git-common-dir"]);
  const commonDir = gitCommonDir.trim();
  
  // Resolve to absolute path (handles both absolute and relative paths)
  const absoluteCommonDir = resolve(process.cwd(), commonDir);
  
  // The repository root is the parent of the .git directory
  return dirname(absoluteCommonDir);
}

function ensurePrlDirectory(root: string): string {
  const path = join(root, PRL_WORKTREES_DIR);
  if (!existsSync(path)) {
    mkdirSync(path, {recursive: true});
  }
  return path;
}

function sanitizeSegment(segment: string): string {
  return segment
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function buildWorktreeName(agent: string): string {
  const agentSegment = sanitizeSegment(agent) || "agent";
  return agentSegment;
}

function buildBranchName(worktreeName: string): string {
  return `prl/${worktreeName}`;
}

async function branchExists(root: string, branchName: string): Promise<boolean> {
  const {stdout} = await execa("git", ["branch", "--list", branchName], {
    cwd: root
  });
  return stdout.trim().length > 0;
}

async function findAvailableWorktreeName(
  root: string,
  prlDir: string,
  baseName: string
): Promise<string> {
  let candidate = baseName;
  let counter = 1;

  while (
    existsSync(join(prlDir, candidate)) ||
    (await branchExists(root, buildBranchName(candidate)))
  ) {
    candidate = `${baseName}-${counter}`;
    counter++;
  }

  return candidate;
}

async function findAvailableBranchName(
  root: string,
  agent: string
): Promise<string> {
  const agentSegment = sanitizeSegment(agent) || "agent";
  let branchName = `prl/${agentSegment}-1`;
  let counter = 1;

  while (await branchExists(root, branchName)) {
    counter++;
    branchName = `prl/${agentSegment}-${counter}`;
  }

  if (counter > 1) {
    console.log(
      `Branch name conflict detected—using ${branchName} instead of prl/${agentSegment}-1.`
    );
  }

  return branchName;
}

export async function createWorktree(
  agent: string,
  options: CreateWorktreeOptions = {}
): Promise<WorktreeDescriptor> {
  const root = await getRepoRoot();
  const prlDir = ensurePrlDirectory(root);
  
  let worktreeName: string;
  let branchName: string;

  if (options.worktreeName) {
    // Explicit worktree name provided
    worktreeName = sanitizeSegment(options.worktreeName);
    const worktreePath = join(prlDir, worktreeName);
    
    // Check if worktree directory already exists
    if (existsSync(worktreePath)) {
      throw new Error(
        `Worktree directory '.prl-worktrees/${worktreeName}' already exists. Choose a different name.`
      );
    }
    
    // Branch name is auto-incremented based on agent name
    branchName = await findAvailableBranchName(root, agent);
  } else {
    // Default: use agent name for both worktree and branch
    const baseName = buildWorktreeName(agent);
    worktreeName = await findAvailableWorktreeName(root, prlDir, baseName);
    branchName = buildBranchName(worktreeName);
    
    if (worktreeName !== baseName) {
      console.log(
        `Worktree name conflict detected—using ${worktreeName} instead of ${baseName}.`
      );
    }
  }

  const worktreePath = join(prlDir, worktreeName);

  // Install signal handlers for cleanup on interruption during worktree creation
  let worktreeCreated = false;
  let branchCreated = false;
  
  const cleanup = async () => {
    try {
      // Try to remove worktree if it was created
      if (worktreeCreated && existsSync(worktreePath)) {
        await execa("git", ["worktree", "remove", "--force", worktreePath], {
          cwd: root,
          stdio: "ignore"
        });
      }
      // Try to delete branch if it was created
      if (branchCreated && (await branchExists(root, branchName))) {
        await execa("git", ["branch", "-D", branchName], {
          cwd: root,
          stdio: "ignore"
        });
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  };

  const signalHandler = (signal: NodeJS.Signals) => {
    // Run cleanup asynchronously, then exit
    cleanup()
      .then(() => {
        console.error("\nWorktree creation interrupted. Cleaned up partial state.");
        process.exit(1);
      })
      .catch(() => {
        process.exit(1);
      });
  };

  process.on("SIGINT", signalHandler);
  process.on("SIGTERM", signalHandler);

  try {
    await execa(
      "git",
      ["worktree", "add", "-b", branchName, worktreePath, "HEAD"],
      {
        cwd: root,
        stdio: "inherit"
      }
    );
    worktreeCreated = true;
    branchCreated = true;
  } catch (error) {
    // If worktree creation failed, try to clean up any partial state
    await cleanup();
    throw error;
  } finally {
    // Remove signal handlers after worktree creation attempt
    process.removeListener("SIGINT", signalHandler);
    process.removeListener("SIGTERM", signalHandler);
  }

  try {
    console.log("Running npm install inside the agent worktree...");
    await execa("npm", ["install"], {
      cwd: worktreePath,
      stdio: "inherit"
    });
  } catch (error) {
    console.warn(
      "npm install failed inside the agent worktree—continuing with shell startup."
    );
  }

  return {
    agent,
    worktreeName,
    branchName,
    worktreePath,
    root
  };
}

export async function removeWorktree(
  descriptor: WorktreeDescriptor
): Promise<void> {
  try {
    await execa(
      "git",
      ["worktree", "remove", "--force", descriptor.worktreePath],
      {
        cwd: descriptor.root,
        stdio: "ignore"
      }
    );
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

export async function listWorktrees(
  rootOverride?: string
): Promise<WorktreeDescriptor[]> {
  const root = rootOverride ?? (await getRepoRoot());
  const prlDir = join(root, PRL_WORKTREES_DIR);
  if (!existsSync(prlDir)) {
    return [];
  }

  const entries = await readdir(prlDir, {withFileTypes: true});
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const worktreeName = entry.name;
      return {
        agent: worktreeName,
        branchName: buildBranchName(worktreeName),
        worktreeName,
        worktreePath: join(prlDir, worktreeName),
        root
      };
    });
}

export async function describeWorktreeByBranch(
  branchName: string
): Promise<WorktreeDescriptor | undefined> {
  const root = await getRepoRoot();
  const candidates = await listWorktrees(root);
  return candidates.find((candidate) => candidate.branchName === branchName);
}

