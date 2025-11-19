# `git prl <agent>` Command Specification

## Overview
The main command that creates an isolated git worktree for an agent, validates the agent command exists, runs it with any provided arguments, and provides an interactive shell for follow-up work.

## Inputs

### Required
- **Positional argument:** `<agent>` - Name of the executable/command to run
  - Examples: `claude`, `aider`, `cursor-agent`
  - Must be a valid executable found in PATH or be resolvable as a command

### Optional
- **`-w, --worktree <name>`** - Explicitly name the worktree directory
  - Must come BEFORE the agent name
  - Sanitized: lowercase, alphanumeric + hyphens only
  - Worktree directory: `.prl-worktrees/<name>` (the provided name, sanitized)
  - Branch name: `prl/<agent>-1`, `prl/<agent>-2`, etc. (auto-incremented based on agent name)
  - Example: `git prl --worktree newfeature claude -c` → worktree directory: `newfeature`, branch: `prl/claude-1` (or `prl/claude-2` if `-1` exists)
  - If omitted: Uses agent name (sanitized) for both worktree directory and branch name

### Agent Arguments (ALL Arguments After Agent Name)
- **ALL flags and arguments after the agent name are passed directly to the agent command**
- **Parsing rule:** Everything before the agent name = `git prl` flags; everything after = agent arguments
- Example: `git prl claude -c` → runs `claude -c` inside the worktree (passes `-c` to claude)
- Example: `git prl claude -n bugfix` → runs `claude -n bugfix` inside the worktree (passes `-n bugfix` to claude)
- Example: `git prl aider --model gpt-4` → runs `aider --model gpt-4` inside the worktree
- Example: `git prl --worktree myfeature claude -c --continue` → worktree: `myfeature`, runs `claude -c --continue`
- **Validation logic:** 
  - **Step 3:** We only validate that the agent command EXISTS in PATH (before creating worktree)
  - **Step 8:** We don't validate that its arguments are valid; if agent fails with invalid args, we continue to shell
  - **Rationale:** If the command exists, the worktree is valid. Invalid arguments can be fixed by the user in the interactive shell. Only non-existent commands prevent worktree creation.

## Step-by-Step Automation Flow

### Step 1: Validate Repository Context
- **Action:** Verify we're inside a git repository
- **Method:** `git rev-parse --show-toplevel`
- **On failure:** Exit with error: `"Not a git repository. Run this command from inside a git repo."`
- **Directory:** Can run from any subdirectory; command resolves repo root automatically

### Step 2: Parse and Extract Agent Arguments
- **Action:** Separate `git prl` flags from agent arguments
- **Parsing rule:** Everything before the agent name = `git prl` flags; everything after = agent arguments
- **Method:** 
  - Parse known `git prl` flags (`-w/--worktree`) that appear before the agent name
  - Extract agent name (first positional argument after all known flags)
  - All remaining arguments after agent name are agent arguments (passed through)
- **Result:** 
  - `-w/--worktree` flag value (if provided)
  - Agent name (positional argument)
  - All remaining flags/arguments (everything after agent name) - pass directly to agent command
- **Important:** We do NOT parse or validate agent-specific flags. If user types `git prl claude -n bugfix`, the `-n bugfix` is passed to claude, not interpreted as a git prl flag.

### Step 3: Validate Agent Command Exists
- **Action:** Check that the agent command can be found and executed
- **Method:** Use `which <agent>` or `command -v <agent>` (Unix) to check if command exists in PATH
- **Why before worktree creation:** Avoid creating worktree/branch if command is invalid
- **On failure:** Exit with error: `"<agent> is not a command that can launch an agent. Is it installed and in your PATH?"`
- **Examples:**
  - `git prl claud` (typo) → Error: `"claud is not a command that can launch an agent..."`
  - `git prl nonexistent` → Error: `"nonexistent is not a command that can launch an agent..."`
  - User doesn't have `claude` installed → Error: `"claude is not a command that can launch an agent..."`

### Step 4: Ensure `.prl-worktrees` Directory Exists
- **Action:** Create worktree container directory if missing
- **Method:** `mkdirSync(<repo-root>/.prl-worktrees, { recursive: true })`
- **On failure:** Exit with error (disk space, permissions, etc.)

### Step 5: Generate Unique Worktree Name and Branch Name
- **Action:** Create unique names for the worktree directory and branch
- **Process:**
  
  **If `--worktree <name>` provided:**
  1. Worktree directory name: Use provided name (sanitized: lowercase, alphanumeric + hyphens only)
  2. Check if worktree directory already exists at `.prl-worktrees/<name>`
  3. If directory exists: Exit with error (user explicitly named it, conflict is an error)
  4. Branch name: Based on agent name with auto-increment
     - Sanitize agent name: lowercase, replace non-alphanumeric with hyphens, trim leading/trailing hyphens
     - Base branch name: `prl/<agent>-1`
     - Check if branch `prl/<agent>-1` exists, if so try `prl/<agent>-2`, etc. until unique
     - Log if auto-incrementing: `"Branch name conflict detected—using prl/<agent>-<N> instead of prl/<agent>-1."`
  
  **If `--worktree` NOT provided (default behavior):**
  1. Sanitize agent name: lowercase, replace non-alphanumeric with hyphens, trim leading/trailing hyphens
  2. Base name: Use sanitized `<agent>` as both worktree directory and branch name base
  3. Check for conflicts:
     - Does `.prl-worktrees/<name>` directory exist?
     - Does `prl/<name>` branch exist?
  4. If conflict found: append `-1`, then `-2`, etc. until both are unique
  5. Log if auto-incrementing: `"Worktree name conflict detected—using <name> instead of <base-name>."`

### Step 6: Create Git Worktree (With Signal Handling)
- **Action:** Create new branch and worktree from HEAD, with cleanup on interruption
- **Method:** `git worktree add -b prl/<name> <repo-root>/.prl-worktrees/<name> HEAD`
- **What this does:** 
  - Creates new branch `prl/<name>` starting from current HEAD
  - Creates worktree directory at `.prl-worktrees/<name>`
  - Checks out the new branch in that worktree

- **Signal Handler During Creation:**
  - Install SIGINT (Ctrl+C) and SIGTERM handlers before starting `git worktree add`
  - If signal received during creation:
    1. Attempt to clean up partial state:
       - Remove worktree directory if it exists: `git worktree remove --force <path>` or `rm -rf <path>`
       - Delete branch if it was created: `git branch -D prl/<name>`
    2. Exit with error message: `"Worktree creation interrupted. Cleaned up partial state."`
  - Remove signal handlers after successful creation
  - **On failure:** Exit with error (disk space, permissions, invalid HEAD, etc.)
  - **On signal during creation:** Clean up partial state and exit gracefully

- **Future consideration:** Support `--base-branch` option to specify different base than HEAD (e.g., `main`, `develop`)

### Step 7: Run `npm install` (Non-Blocking)
- **Action:** Install npm dependencies if `package.json` exists
- **Method:** `npm install` inside worktree directory
- **On failure:** Log warning and continue: `"npm install failed inside the agent worktree—continuing with shell startup."`
- **Why non-blocking:** Agent might not need npm, or might handle dependencies itself

### Step 8: Execute Agent Command
- **Action:** Run the agent command with any provided arguments
- **Method:** `execa(agentName, agentArgs, { cwd: worktreePath, stdio: "inherit" })`
- **Arguments passed through:** ALL flags and arguments after agent name from Step 2 are passed as `agentArgs` array
- **On failure (invalid arguments, command error, etc.):** 
  - Log error: `"Agent command <agent> failed; you can recover inside <worktree-path>."`
  - **Do NOT exit** - continue to Step 9 (spawn interactive shell in worktree directory)
  - **Worktree is already created:** Worktree and branch were created in Step 6, so they remain available
  - **Recovery:** A new interactive shell will be spawned in Step 9 (same terminal window, cd'd into worktree). User can manually run the agent with correct arguments in that shell.
  - **Why continue:** The agent command exists (validated in Step 3), so worktree is valid. Invalid arguments can be fixed by user in the spawned shell.
- **On success:** Continue to Step 9 (spawn interactive shell in worktree directory)

### Step 9: Open Interactive Shell (TTY-Only)
- **What This Does:** After the agent exits, spawns a new interactive shell process inside the worktree directory so you can continue working in the same place (same worktree, same branch). The new shell takes over your current terminal window (not a new tab), so you stay in the same terminal but are now "inside" the worktree directory.
- **Why This Exists:** When the agent finishes its work and exits, you may want to continue working in that same worktree/branch context - review changes, commit, test, run more commands, etc. Instead of manually navigating to the worktree directory, we drop you into a shell already cd'd there.

- **TTY Explanation:** 
  - **TTY (Terminal):** Interactive terminal session where stdin/stdout/stderr are attached (your regular terminal window)
  - **Non-TTY:** Scripts, pipes (`git prl claude | grep foo`), CI environments without interactive terminals
  - **Check:** `process.stdin.isTTY && process.stdout.isTTY`
  
- **If TTY Available:**
  - **Action:** Spawn a new interactive shell process, cd'd into the worktree directory
  - **Method:** 
    - Determine shell: `process.env.SHELL` (Unix) or fallback to `/bin/bash`
    - Spawn new shell process: `execa(shellPath, ["-i"], { cwd: worktreePath, stdio: "inherit", env: { ...process.env, PRL_WORKTREE_PATH: worktreePath } })`
    - `stdio: "inherit"` means the new shell takes over your current terminal (same window, not a new tab)
    - `-i` flag makes shell interactive (loads `.bashrc`, `.zshrc`, etc.)
    - `cwd: worktreePath` means the new shell starts already cd'd into the worktree directory
  - **User Experience:** 
    - After agent exits, you stay in your same terminal window
    - A new shell process is spawned, and your terminal becomes that shell
    - You're automatically in the worktree directory, on the agent's branch
    - You can continue working: review changes, commit, test, run commands, or run the agent again with corrected arguments
    - When you type `exit` or press Ctrl+D, the shell exits and control returns to git prl
  - **Environment:** Set `PRL_WORKTREE_PATH` so agent scripts can detect worktree context
  - **On exit:** Control returns to git prl, logs exit reason (signal or exit code), then proceeds to Step 10
  
- **If Not TTY:**
  - **Action:** Skip spawning shell entirely
  - **Log:** `"Worktree shell skipped because this session is not attached to a terminal."`

### Step 10: Prompt for Cleanup (Runs on Normal Exit Only)
- **Action:** Ask user if they want to delete worktree and branch
- **Runs in:** `finally` block - executes when control returns from the interactive shell (Step 9)
- **Note:** Reaches this step whether Step 8 (agent execution) succeeded or failed. Worktree is always available for recovery.
- **Important:** This step only runs if the user exits the shell normally (via `exit` or Ctrl+D). If the terminal tab/window is closed or the process is forcefully killed, this step does NOT run.
- **If TTY Available:**
  - Prompt: `"Delete branch prl/<name> and its worktree?"`
  - If yes: Remove worktree and branch, log: `"Worktree removed."`
  - If no: Log: `"You can run 'git prl prune' later to clean up this worktree."`
  
- **If Not TTY:**
  - Log: `"Worktree <branch-name> remains at <worktree-path>. Run 'git prl prune' when ready."`

## Edge Cases & Failure Modes

### Repository/Environment Issues
- **Not in git repository:** Fail at Step 1 with clear error message
- **Detached HEAD:** `git worktree add` may fail if HEAD is invalid; handle gracefully
- **No disk space:** Worktree creation fails (Step 6); surface OS-level error
- **Insufficient permissions:** Fail when creating directory (Step 4) or running git commands (Step 6)

### Agent Command Validation
- **Command doesn't exist:** Fail at Step 3 before creating worktree
  - Examples: typos (`claud`), uninstalled agents (`claude` not in PATH)
  - Error: `"<agent> is not a command that can launch an agent. Is it installed and in your PATH?"`
  - **No worktree created** - validation happens before Step 4
- **Command exists but fails with invalid arguments:** Step 8 logs error, worktree remains, spawns interactive shell
  - Example: `git prl claude -x` where `-x` is not a valid claude flag
  - Example: `git prl -w newfeature claude -xyz` where `-xyz` is invalid
  - Worktree is created in Step 6, agent fails in Step 8, but worktree and branch remain available
  - Error logged: `"Agent command <agent> failed; you can recover inside <worktree-path>."`
  - New interactive shell process is spawned in Step 9 (same terminal window, cd'd into worktree)
  - User can manually run agent with correct arguments in that spawned shell
  - Cleanup prompt appears (Step 10) after user exits the spawned shell
- **Command hangs:** User can Ctrl+C; cleanup prompt still appears (Step 10) after shell opens
- **Validation logic:** 
  - **Step 3:** Validate that agent command EXISTS in PATH → Fail before creating worktree if doesn't exist
  - **Step 8:** Run agent command → If fails (invalid args), continue to shell for recovery
  - **Rationale:** If command exists, worktree is valid. Invalid arguments can be fixed by user in the shell.
- **Orphaned worktrees (terminal closed/process killed):**
  - **Current limitation:** We cannot detect if an agent is actively working in a worktree vs. if the worktree is orphaned
  - **Detection:** If terminal closes or process is killed, worktree and branch remain, but no metadata tracks if it's "active"
  - **Why this matters:** We don't know if `git prl prune` is safe to run on a worktree - someone might still be using it in another terminal
  - **Current solution:** `git prl prune` prompts user before removing each worktree (user can decide if it's safe)
  - **Future:** Could track PIDs, creation times, last activity in metadata to detect orphaned worktrees automatically

### Naming Conflicts
- **Worktree name collision:** Auto-increment (`-1`, `-2`) and log warning
- **Branch name collision:** Same auto-increment logic
- **Sanitization produces empty string:** Fallback to `"agent"` as base name
- **Very long names:** Filesystem limits (typically 255 chars); sanitization may help

### Worktree Creation Issues
- **Race condition:** Multiple simultaneous runs could create same name
  - **Current mitigation:** Check both filesystem and git branches, but small window exists
  - **Future:** Could add file locking, but current approach is pragmatic for MVP
- **Partial failure during `git worktree add`:** 
  - **Signal handling (SIGINT/SIGTERM during creation):** Step 6 installs signal handlers that clean up partial state (worktree directory and branch) if user Ctrl+C during creation
  - **On interruption:** Cleanup attempted automatically, then exit with error message
  - **If cleanup fails:** Partial state may remain; user can run `git prl prune` or manually remove directory/branch
- **Worktree directory conflict with `--worktree`:** If user explicitly names worktree and it already exists, exit with error (user should choose a different name)

### Shell Interaction
- **Non-TTY environment:** Shell skipped (Step 9), cleanup prompt skipped (Step 10), instructions logged
- **Shell spawn fails:** Log error but still prompt for cleanup
- **User exits shell normally (exit/Ctrl+D):** Cleanup prompt appears (Step 10)
- **Terminal tab/window closed or process killed:** 
  - **What happens:** The git prl process is killed (SIGHUP/SIGTERM), Step 10 cleanup prompt does NOT run
  - **Result:** Worktree and branch remain orphaned (no cleanup happens)
  - **Detection:** We cannot detect if an agent/worktree is still "active" vs. orphaned - worktree exists, branch exists, but no running process
  - **Recovery:** User must manually run `git prl prune` to clean up orphaned worktrees
  - **Future consideration:** Could track metadata (PID, creation time) in `.git/prl-meta/` to detect orphaned worktrees, but this is out of MVP scope

### Cleanup Failures
- **Worktree removal fails:** `removeWorktree` swallows errors but branch deletion may still succeed
- **Branch deletion fails:** Both worktree and branch may remain; user can use `git prl prune`
- **Files locked by another process:** Removal fails silently; user must manually unlock and run `prune`

## Platform Considerations

### Unix-Only (Linux & macOS)
- **Shell detection:** Use `process.env.SHELL` or fallback to `/bin/bash`
- **Shell args:** Always `["-i"]` for interactive mode
- **Path handling:** Use `path.join()` for cross-platform paths (still works on Unix)
- **No Windows support:** Removed `win32` checks; simplifies code

## Examples

### Basic Usage
```bash
git prl claude
# → Validates 'claude' exists in PATH
# → Creates prl/claude branch and worktree
# → Runs 'claude' inside worktree (agent takes over terminal, user interacts with agent)
# → Agent exits when done
# → Spawns new interactive shell process (same terminal window, cd'd into worktree)
# → User is now in that shell, already in the worktree directory
# → User can continue working: review changes, commit, test, run commands
# → When user types 'exit', shell exits and cleanup prompt appears
```

### With Agent Arguments
```bash
git prl claude -c
# → Creates prl/claude branch and worktree
# → Validates 'claude' exists in PATH
# → Runs 'claude -c' inside worktree (continues conversation)
# → Passes '-c' to claude (not interpreted as git prl flag)

git prl claude -n bugfix
# → Creates prl/claude branch and worktree
# → Validates 'claude' exists
# → Runs 'claude -n bugfix' inside worktree
# → Passes '-n bugfix' to claude (not interpreted as git prl flag)

git prl aider --model gpt-4
# → Creates prl/aider branch and worktree
# → Validates 'aider' exists
# → Runs 'aider --model gpt-4' inside worktree
# → Passes '--model gpt-4' to aider
```

### With Explicit Worktree Name
```bash
git prl --worktree newfeature claude -c
# → Worktree directory: .prl-worktrees/newfeature
# → Branch: prl/claude-1 (or prl/claude-2 if -1 exists)
# → Validates 'claude' exists in PATH
# → Runs 'claude -c' inside worktree
# → '-c' is passed to claude (not interpreted as git prl flag)

git prl -w myfix aider --model gpt-4
# → Worktree directory: .prl-worktrees/myfix
# → Branch: prl/aider-1 (or prl/aider-2 if -1 exists)
# → Validates 'aider' exists
# → Runs 'aider --model gpt-4' inside worktree
# → '--model gpt-4' is passed to aider
```

### Error Cases
```bash
git prl claud
# → Error: "claud is not a command that can launch an agent. Is it installed and in your PATH?"
# → Worktree NOT created (validation happens before creation)

git prl nonexistent --some-flag
# → Error: "nonexistent is not a command that can launch an agent..."
# → Worktree NOT created (validation happens before creation)

git prl --worktree existingname claude
# → Error: "Worktree directory '.prl-worktrees/existingname' already exists. Choose a different name."
# → Worktree NOT created (explicit name conflict)

git prl blablabla
# → Validates 'blablabla' exists in PATH
# → Error: "blablabla is not a command that can launch an agent. Is it installed and in your PATH?"
# → Worktree NOT created (validation fails before creation)

git prl -w newfeature claude -xyz
# → Validates 'claude' exists in PATH ✓
# → Worktree directory: .prl-worktrees/newfeature (CREATED)
# → Branch: prl/claude-1 (CREATED)
# → Runs 'claude -xyz' inside worktree
# → 'claude -xyz' fails (invalid flag for claude)
# → Error logged: "Agent command claude failed; you can recover inside <worktree-path>."
# → Worktree and branch REMAIN (not cleaned up)
# → Agent exits (with error)
# → New interactive shell process is spawned (same terminal window, cd'd into worktree)
# → User is now in that shell, already in the worktree directory
# → User can manually run 'claude' (with correct args) to continue working
# → Or user can review changes, commit, test, etc. in that same worktree context
# → When user types 'exit', shell exits and cleanup prompt appears
# → Worktree is available for recovery/continued work
```

## Future Enhancements (Out of MVP Scope)

1. **`--base-branch` option:** Allow specifying base branch instead of always using HEAD
   - Example: `git prl claude --base-branch main` creates branch from `main` even if you're on `feature-x`

2. **Crash recovery metadata:** Track creation time, PID, etc. for detecting crashed sessions
   - Currently: No metadata tracking
   - Enhancement: Store metadata in `.git/prl-meta/` for enhanced `list` and recovery features

3. **Windows support:** Re-add platform-specific shell handling (removed for MVP)

4. **Argument validation:** Pre-validate agent-specific flags before running (requires per-agent config)
   - Currently: Agent itself validates and errors; we pass everything through

