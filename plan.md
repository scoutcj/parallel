## PRL Worktree CLI Plan

### Goal
Build a Node-based, npm-installable CLI distributed as `git prl` that automates git worktree setup per agent so users can run agents in parallel, keep branches isolated, and easily merge or prune agent worktrees when done.

### Command Surface (MVP)

- `git prl <agent> [--name <suffix>]`
  - Creates a worktree under `.prl-worktrees/<agent>-<suffix?>` and branch `prl/<agent>` or `prl/<agent>-<suffix>`.
  - Runs `npm install` inside the worktree before dropping the user into a shell layered on that branch.
  - Hooks `exit`/`SIGINT` to prompt the user whether to delete the worktree/branch on close; if they decline, leave state for manual cleanup.

- `git prl apply`
  - Run from an active agent worktree; merges `prl/<agent>` into local `main` (or configured base), surfacing merge conflicts so Git/IDE tooling can resolve them.
  - After a successful merge, optionally prune the agent branch/worktree (and surface instructions for rerunning `apply` after fixing conflicts).

- `git prl list`
  - Enumerates `.prl-worktrees/*` along with branch names and whether the worktree is currently mounted so users can see running agents in parallel.

- `git prl prune`
  - Removes dangling `prl/*` worktrees/branches that are no longer active (e.g., after crashes or `apply`).
  - **Active vs Inactive Worktrees:**
    - **Active worktree:** Has uncommitted changes or is currently being used by an agent. Should NOT be pruned automatically.
    - **Inactive worktree:** Already merged into main (or base branch) and has no uncommitted changes. Safe to prune.
  - Should detect worktree state and warn user before pruning active worktrees.
  - Git will handle detection of uncommitted changes when attempting to remove worktrees.

### Behaviors to Note

- Document that users should not rename worktree directories manually via GUIs; doing so breaks tooling assumptions.
- Merge conflicts triggered by `apply` depend on Git—expose conflict status and suggest running an IDE resolver, and encourage rerunning `apply` after resolving/committing.
- Prompt on shell exit/terminal close with `readline`-style confirmation before deleting the worktree. Default to leaving state in non-interactive exits.
- Allow multiple agents to run concurrently by guaranteeing unique branch/worktree names (include suffix handling and safeguards against reuse).

### Tech Stack

- Node.js (TypeScript) CLI so the package is npm-installable; `package.json` supplies the `bin` entry for `git-prl`.
- Use `commander` or `yargs` for argument parsing and `execa` for Git/worktree shell interactions.
- Track metadata (e.g., creation time, suffix, branch name) under `.git/prl-meta/` if needed to support `list/status` in future iterations.
- Implement helper modules for naming, git command orchestration, worktree lifecycle, and cleanup hooks.

### Next Steps

1. Create `package.json`, CLI bootstrap (`bin/prl.js`), and TypeScript source layout (`src/`).
2. Build worktree management core (`src/worktree.ts`, naming helpers, cleanup prompts).
3. Implement CLI commands (`start`, `apply`, `list`, `prune`) and connect them via `commander`.


