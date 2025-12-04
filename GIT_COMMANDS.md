# Git Commands and Bash Operations Automated by git-prl

This document lists all the git commands and bash operations that are automated for each `git prl` command.

## `git prl <agent>` (e.g., `git prl claude`)

### Git Commands:
1. **Get repository root:**
   ```bash
   git rev-parse --git-common-dir
   # Returns: .git (or .git/worktrees/<name> for worktrees)
   # We get parent directory to get repo root
   ```

2. **Check if branch exists (for auto-increment):**
   ```bash
   git branch --list prl/claude
   git branch --list prl/claude-1
   git branch --list prl/claude-2
   # ... until we find one that doesn't exist
   ```

3. **Create worktree and branch:**
   ```bash
   git worktree add -b prl/claude .prl-worktrees/claude HEAD
   # This command:
   # - Creates new branch `prl/claude` from HEAD
   # - Creates worktree directory at `.prl-worktrees/claude`
   # - Checks out the branch in that worktree
   ```

4. **Cleanup on interruption (if user Ctrl+C during creation):**
   ```bash
   git worktree remove --force .prl-worktrees/claude
   git branch -D prl/claude
   ```

### Bash Operations:
1. **Validate agent command exists:**
   ```bash
   command -v claude
   # Returns exit code 0 if found, non-zero if not found
   ```

2. **Create directory structure:**
   ```bash
   mkdir -p .prl-worktrees
   mkdir -p .prl-worktrees/template
   ```

3. **Initialize template from main (first time only):**
   ```bash
   # Copy these files from repo root to .prl-worktrees/template/:
   cp .env .prl-worktrees/template/.env
   cp .env.local .prl-worktrees/template/.env.local
   cp .env.development .prl-worktrees/template/.env.development
   cp .env.production .prl-worktrees/template/.env.production
   cp .env.test .prl-worktrees/template/.env.test
   cp package.json .prl-worktrees/template/package.json
   cp package-lock.json .prl-worktrees/template/package-lock.json
   cp .eslintrc .prl-worktrees/template/.eslintrc
   cp .eslintrc.js .prl-worktrees/template/.eslintrc.js
   cp .eslintrc.json .prl-worktrees/template/.eslintrc.json
   cp .eslintrc.yaml .prl-worktrees/template/.eslintrc.yaml
   cp .eslintrc.yml .prl-worktrees/template/.eslintrc.yml
   cp .prettierrc .prl-worktrees/template/.prettierrc
   cp .prettierrc.js .prl-worktrees/template/.prettierrc.js
   cp .prettierrc.json .prl-worktrees/template/.prettierrc.json
   cp .prettierignore .prl-worktrees/template/.prettierignore
   cp tsconfig.json .prl-worktrees/template/tsconfig.json
   cp .gitignore .prl-worktrees/template/.gitignore
   # (Only copies files that exist)
   ```

4. **Copy template files to worktree:**
   ```bash
   # Copy all files from .prl-worktrees/template/ to .prl-worktrees/claude/
   cp .prl-worktrees/template/.env .prl-worktrees/claude/.env
   cp .prl-worktrees/template/package.json .prl-worktrees/claude/package.json
   # ... (all template files, preserving directory structure if needed)
   ```

5. **Install npm dependencies:**
   ```bash
   cd .prl-worktrees/claude
   npm install
   # (Non-blocking - continues even if this fails)
   ```

6. **Run agent command:**
   ```bash
   cd .prl-worktrees/claude
   claude [agent-args...]
   # (Continues to shell even if this fails)
   ```

7. **Spawn interactive shell:**
   ```bash
   cd .prl-worktrees/claude
   $SHELL -i
   # (Only if TTY available)
   ```

### Notes:
- Template files are copied, NOT node_modules (node_modules is created by `npm install`)
- Template is initialized once from main, then reused for all new worktrees
- Worktree name and branch name can auto-increment if conflicts exist
- If `--worktree <name>` is provided, worktree uses that name but branch still auto-increments based on agent name

---

## `git prl apply`

### Git Commands:
1. **Get repository root:**
   ```bash
   git rev-parse --git-common-dir
   ```

2. **Get current branch:**
   ```bash
   git rev-parse --abbrev-ref HEAD
   # Returns: prl/claude (or whatever prl branch we're on)
   ```

3. **Check if remote tracking branch exists:**
   ```bash
   git rev-parse --abbrev-ref main@{upstream}
   # Returns: origin/main (or empty if no upstream)
   ```

4. **Fetch remote refs (quiet, doesn't modify working tree):**
   ```bash
   git fetch --quiet
   ```

5. **Check if local main is behind remote:**
   ```bash
   git rev-list --count main..origin/main
   # Returns: number of commits behind (0 if up to date)
   ```

6. **Update main from remote (if user confirms):**
   ```bash
   git fetch origin main
   git checkout main
   git merge origin/main
   git checkout prl/claude  # Return to prl branch
   ```

7. **Merge prl branch into main:**
   ```bash
   git checkout main
   git merge --no-ff prl/claude
   # --no-ff ensures we always create a merge commit
   ```

8. **Cleanup worktree (if user confirms or --auto-cleanup):**
   ```bash
   git worktree remove --force .prl-worktrees/claude
   git branch -D prl/claude
   ```

### Bash Operations:
1. **Validate we're in a prl branch:**
   ```bash
   # Check that current branch starts with "prl/"
   # Exit with error if not
   ```

2. **Find worktree directory:**
   ```bash
   # Look for .prl-worktrees/<worktree-name> directory
   # Worktree name is extracted from branch name (prl/claude -> claude)
   ```

### Notes:
- Must be run from inside a prl worktree directory
- Checks if main is behind remote and prompts user to update first
- Always creates merge commit (--no-ff) to preserve branch history
- If merge has conflicts, user must resolve and rerun command

---

## `git prl list`

### Git Commands:
1. **Get repository root:**
   ```bash
   git rev-parse --git-common-dir
   ```

### Bash Operations:
1. **List worktree directories:**
   ```bash
   find .prl-worktrees -mindepth 1 -maxdepth 1 -type d ! -name template
   # Or: ls -d .prl-worktrees/*/ | grep -v template
   # Returns list of worktree directory names
   ```

2. **Display worktree info:**
   ```bash
   # For each worktree directory:
   # - Branch name: prl/<worktree-name>
   # - Worktree path: .prl-worktrees/<worktree-name>
   ```

### Notes:
- Only lists directories in `.prl-worktrees/` (excludes `template/`)
- Doesn't verify that worktrees are still valid git worktrees
- Simple read-only operation

---

## `git prl prune`

### Git Commands:
1. **Get repository root:**
   ```bash
   git rev-parse --git-common-dir
   ```

2. **For each worktree (if user confirms):**
   ```bash
   git worktree remove --force .prl-worktrees/claude
   git branch -D prl/claude
   ```

### Bash Operations:
1. **List worktree directories:**
   ```bash
   find .prl-worktrees -mindepth 1 -maxdepth 1 -type d ! -name template
   ```

2. **Prompt user for each worktree:**
   ```bash
   # Interactive prompt: "Prune worktree prl/claude at .prl-worktrees/claude? (y/N):"
   # Only if TTY available
   ```

### Notes:
- Prompts for each worktree individually
- Skips non-TTY environments (no prompts, just lists)
- Removes both worktree directory and branch
- Uses `--force` to remove worktree even if it has uncommitted changes

---

## Summary of All Git Commands Used

### Repository Operations:
- `git rev-parse --git-common-dir` - Get repo root
- `git rev-parse --abbrev-ref HEAD` - Get current branch
- `git rev-parse --abbrev-ref <branch>@{upstream}` - Get upstream branch

### Branch Operations:
- `git branch --list <branch>` - Check if branch exists
- `git branch -D <branch>` - Delete branch (force)

### Worktree Operations:
- `git worktree add -b <branch> <path> HEAD` - Create worktree and branch
- `git worktree remove --force <path>` - Remove worktree (force)

### Remote Operations:
- `git fetch --quiet` - Fetch remote refs quietly
- `git fetch origin <branch>` - Fetch specific branch

### Merge Operations:
- `git checkout <branch>` - Switch branch
- `git merge --no-ff <branch>` - Merge with merge commit
- `git merge origin/<branch>` - Merge remote branch

### Analysis Operations:
- `git rev-list --count <branch1>..<branch2>` - Count commits between branches

---

## Summary of All Bash Operations

### File System:
- `mkdir -p <dir>` - Create directories
- `cp <src> <dest>` - Copy files
- `find <dir> -type f` - Find files
- `test -d <dir>` - Check if directory exists
- `test -f <file>` - Check if file exists

### Command Validation:
- `command -v <cmd>` - Check if command exists in PATH

### Process Operations:
- `cd <dir>` - Change directory
- `npm install` - Install dependencies
- `$SHELL -i` - Spawn interactive shell

### String Operations:
- `tr '[:upper:]' '[:lower:]'` - Convert to lowercase
- `sed` - Pattern replacement for sanitization
- `grep` - Pattern matching



