#!/bin/bash
# git prl apply - Merge current branch into main

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/prl-common.sh"

BASE_BRANCH="${1:-main}"
AUTO_CLEANUP="${2:-false}"

# Step 1: Validate repository context
ROOT=$(get_repo_root)
if [ -z "$ROOT" ]; then
  echo "Error: Not a git repository. Run this command from inside a git repo." >&2
  exit 1
fi

# Step 2: Get current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ -z "$CURRENT_BRANCH" ] || [ "$CURRENT_BRANCH" = "HEAD" ]; then
  echo "Error: Could not determine current branch. Are you in a detached HEAD state?" >&2
  exit 1
fi

# Check if already on base branch
if [ "$CURRENT_BRANCH" = "$BASE_BRANCH" ]; then
  echo "Error: You're already on $BASE_BRANCH. Nothing to apply. Run \`git prl apply\` from a prl worktree branch." >&2
  exit 1
fi

# Handle non-prl branches
if [ "$CURRENT_BRANCH" != "HEAD" ] && [[ ! "$CURRENT_BRANCH" =~ ^prl/ ]]; then
  echo "Error: \`git prl apply\` must be run from an active prl worktree branch. Current branch: $CURRENT_BRANCH" >&2
  exit 1
fi

# Step 3: Locate worktree metadata
WORKTREE_INFO=$(get_worktree_by_branch "$ROOT" "$CURRENT_BRANCH" || echo "")
if [ -z "$WORKTREE_INFO" ]; then
  # Check if worktree directory exists
  WORKTREE_NAME="${CURRENT_BRANCH#prl/}"
  WORKTREE_PATH="$ROOT/.prl-worktrees/$WORKTREE_NAME"
  
  if [ ! -d "$WORKTREE_PATH" ]; then
    echo "Error: Worktree for branch $CURRENT_BRANCH was deleted, moved, or renamed. The branch exists but the worktree directory is missing." >&2
    exit 1
  fi
  
  echo "Error: Could not locate metadata for branch $CURRENT_BRANCH. The worktree may have been manually modified." >&2
  exit 1
fi

# Parse worktree info
IFS='|' read -r WORKTREE_NAME WORKTREE_PATH BRANCH_NAME <<< "$WORKTREE_INFO"

# Step 6: Check if base branch is behind remote (optional)
REMOTE_AHEAD=false
REMOTE_BRANCH=$(git -C "$ROOT" rev-parse --abbrev-ref "${BASE_BRANCH}@{upstream}" 2>/dev/null || echo "")
if [ -n "$REMOTE_BRANCH" ]; then
  # Fetch to update remote refs (quiet)
  git -C "$ROOT" fetch --quiet 2>/dev/null || true
  
  # Check if local is behind remote
  BEHIND_COUNT=$(git -C "$ROOT" rev-list --count "${BASE_BRANCH}..${REMOTE_BRANCH}" 2>/dev/null || echo "0")
  if [ "$BEHIND_COUNT" -gt 0 ]; then
    REMOTE_AHEAD=true
  fi
fi

# Output info to stderr for Node.js to handle prompt
echo "REMOTE_CHECK_START" >&2
echo "REMOTE_AHEAD=$REMOTE_AHEAD" >&2
echo "REMOTE_BRANCH=$REMOTE_BRANCH" >&2
echo "BASE_BRANCH=$BASE_BRANCH" >&2
echo "CURRENT_BRANCH=$CURRENT_BRANCH" >&2
echo "WORKTREE_NAME=$WORKTREE_NAME" >&2
echo "WORKTREE_PATH=$WORKTREE_PATH" >&2
echo "BRANCH_NAME=$BRANCH_NAME" >&2
echo "AUTO_CLEANUP=$AUTO_CLEANUP" >&2
echo "REMOTE_CHECK_END" >&2

# Note: Node.js will handle the remote update prompt and call update_base_branch_from_remote if needed
# Then Node.js will call merge_prl_branch to perform the actual merge

