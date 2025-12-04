#!/bin/bash
# git prl list - List active prl worktrees

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/prl-common.sh"

# Get repository root
ROOT=$(get_repo_root)
if [ -z "$ROOT" ]; then
  echo "Error: Not a git repository. Run this command from inside a git repo." >&2
  exit 1
fi

# List all worktrees
WORKTREES=$(list_worktrees "$ROOT")

if [ -z "$WORKTREES" ]; then
  echo "No active prl worktrees were found."
  exit 0
fi

echo "Active prl worktrees:"
while IFS= read -r worktree_name; do
  if [ -n "$worktree_name" ]; then
    branch_name=$(build_branch_name "$worktree_name")
    worktree_path="$ROOT/.prl-worktrees/$worktree_name"
    echo "- $branch_name ($worktree_path)"
  fi
done <<< "$WORKTREES"



