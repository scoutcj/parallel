# File Structure Analysis

## Project Overview
This is a Node.js/TypeScript CLI tool (`git-prl`) that manages git worktrees for running parallel agents. It uses a hybrid architecture: TypeScript for CLI orchestration and bash scripts for git operations.

## Directory Structure

### `/src/` - TypeScript Source Code
- **`index.ts`** - Main CLI entry point using `commander` for argument parsing
- **`commands/`** - Command implementations:
  - `start.ts` - Creates worktree and runs agent
  - `apply.ts` - Merges prl branch into main
  - `list.ts` - Lists active worktrees
  - `prune.ts` - Removes stale worktrees
- **`utils/`** - Utility modules:
  - `prompt.ts` - Interactive confirmation prompts
  - `scripts.ts` - Path resolution for bash scripts
- **`worktree.ts`** - Type definitions and minimal utilities

### `/scripts/` - Bash Scripts (Active)
These scripts perform the actual git operations:
- **`prl-common.sh`** - Shared helper functions (237 lines)
- **`prl-start.sh`** - Creates worktree and runs agent
- **`prl-apply.sh`** - Checks remote status and validates context
- **`prl-apply-merge.sh`** - Performs the actual merge
- **`prl-list.sh`** - Lists worktrees
- **`prl-prune.sh`** - Lists worktrees for pruning

**Architecture Pattern:** TypeScript commands call bash scripts via `execa`, then parse structured output from stderr.

### `/bin/` - Entry Point
- **`prl.js`** - Simple wrapper that requires the compiled `dist/index.js`

### `/dist/` - Build Output
- Compiled JavaScript and TypeScript declarations
- Generated from `src/` via `tsc`
- **Correctly ignored** in `.gitignore`

### Documentation Files
- **`plan.md`** - Original project plan (49 lines)
- **`SPEC_git_prl_agent.md`** - Detailed command specification (351 lines)
- **`GIT_COMMANDS.md`** - Reference of git commands used (302 lines)

## Redundant/Unused Code Found

### 1. Unused Code in `src/worktree.ts`
- **`CreateWorktreeOptions` interface** (line 14-16) - Defined but never imported or used
- **`getRepoRoot()` function** (line 22-35) - Defined but never called
  - The comment says "Most worktree operations are now handled by bash scripts"
  - Bash scripts use `get_repo_root()` from `prl-common.sh` instead

### 2. Documentation Overlap
- **`GIT_COMMANDS.md`** and **`SPEC_git_prl_agent.md`** have some overlap:
  - Both document git commands used
  - `SPEC_git_prl_agent.md` is more comprehensive (includes examples, edge cases)
  - `GIT_COMMANDS.md` is more focused on just listing commands
  - **Recommendation:** Keep both if they serve different purposes, or consolidate

### 3. Potentially Outdated
- **`plan.md`** - Original planning document. If the project is complete, this could be archived or removed.

## Files That Are NOT Redundant

✅ **All bash scripts** - Actively used by TypeScript commands
✅ **`dist/` directory** - Build output (correctly gitignored)
✅ **TypeScript source files** - All are imported and used
✅ **`bin/prl.js`** - Entry point referenced in `package.json`

## Recommendations

1. **Remove unused code from `worktree.ts`:**
   - Delete `CreateWorktreeOptions` interface
   - Delete `getRepoRoot()` function (or keep if planning to refactor away from bash scripts)

2. **Consider consolidating documentation:**
   - Evaluate if `GIT_COMMANDS.md` adds value beyond `SPEC_git_prl_agent.md`
   - Archive or remove `plan.md` if project is complete

3. **No other redundant files found** - The architecture is clean and all files serve a purpose.

