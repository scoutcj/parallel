import {execa} from "execa";
import {mkdirSync, existsSync} from "fs";
import {promises as fsPromises} from "fs";
import {join} from "path";

const {readdir} = fsPromises;

const PRL_WORKTREES_DIR = ".git/worktrees/prl";

export interface WorktreeDescriptor {
  agent: string;
  suffix?: string;
  branchName: string;
  worktreeName: string;
  worktreePath: string;
  root: string;
}

export async function getRepoRoot(): Promise<string> {
  const {stdout} = await execa("git", ["rev-parse", "--show-toplevel"]);
  return stdout.trim();
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

function buildWorktreeName(agent: string, suffix?: string): string {
  const agentSegment = sanitizeSegment(agent) || "agent";
  const suffixSegment = suffix ? sanitizeSegment(suffix) : "";
  return suffixSegment ? `${agentSegment}-${suffixSegment}` : agentSegment;
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

export async function createWorktree(
  agent: string,
  suffix?: string
): Promise<WorktreeDescriptor> {
  const root = await getRepoRoot();
  const prlDir = ensurePrlDirectory(root);
  const baseName = buildWorktreeName(agent, suffix);
  const worktreeName = await findAvailableWorktreeName(root, prlDir, baseName);
  const branchName = buildBranchName(worktreeName);
  const worktreePath = join(prlDir, worktreeName);

  await execa(
    "git",
    ["worktree", "add", "-b", branchName, worktreePath, "HEAD"],
    {
      cwd: root,
      stdio: "inherit"
    }
  );

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

  if (worktreeName !== baseName) {
    console.log(
      `Worktree name conflict detected—using ${worktreeName} instead of ${baseName}.`
    );
  }

  return {
    agent,
    suffix,
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
        root,
        suffix: undefined
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

