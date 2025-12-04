#!/bin/bash
# git prl apply-merge - Perform the actual merge (called after remote update if needed)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/prl-common.sh"

BASE_BRANCH="${1:-main}"
CURRENT_BRANCH="${2:-}"

if [ -z "$CURRENT_BRANCH" ]; then
  echo "Error: Current branch is required" >&2
  exit 1
fi

# Get repository root
ROOT=$(get_repo_root)
if [ -z "$ROOT" ]; then
  echo "Error: Not a git repository. Run this command from inside a git repo." >&2
  exit 1
fi

# Get worktree info
WORKTREE_INFO=$(get_worktree_by_branch "$ROOT" "$CURRENT_BRANCH" || echo "")
if [ -z "$WORKTREE_INFO" ]; then
  echo "Error: Could not locate worktree for branch $CURRENT_BRANCH" >&2
  exit 1
fi

IFS='|' read -r WORKTREE_NAME WORKTREE_PATH BRANCH_NAME <<< "$WORKTREE_INFO"

# Step 8: Perform merge
if ! merge_prl_branch "$ROOT" "$CURRENT_BRANCH" "$BASE_BRANCH"; then
  echo "Error: Merge encountered conflicts or failed. Resolve them and rerun \`git prl apply\`." >&2
  exit 1
fi

echo "Merged branch $CURRENT_BRANCH into $BASE_BRANCH."

# Output cleanup info to stderr
echo "MERGE_SUCCESS_START" >&2
echo "WORKTREE_NAME=$WORKTREE_NAME" >&2
echo "BRANCH_NAME=$BRANCH_NAME" >&2
echo "WORKTREE_PATH=$WORKTREE_PATH" >&2
echo "MERGE_SUCCESS_END" >&2

