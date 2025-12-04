#!/bin/bash
# git prl <agent> - Create worktree and run agent

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/prl-common.sh"

# Parse arguments
AGENT_NAME="${1:-}"
WORKTREE_NAME="${2:-}"  # Optional explicit worktree name (empty if not provided)
if [ -n "$WORKTREE_NAME" ]; then
  shift 2
  AGENT_ARGS=("$@")
else
  shift 1
  AGENT_ARGS=("$@")
fi

if [ -z "$AGENT_NAME" ]; then
  echo "Error: Agent name is required" >&2
  exit 1
fi

# Step 1: Validate repository context
ROOT=$(get_repo_root)
if [ -z "$ROOT" ]; then
  echo "Error: Not a git repository. Run this command from inside a git repo." >&2
  exit 1
fi

# Step 3: Validate agent command exists
if ! command -v "$AGENT_NAME" >/dev/null 2>&1; then
  echo "Error: $AGENT_NAME is not a command that can launch an agent. Is it installed and in your PATH?" >&2
  exit 1
fi

# Step 4: Ensure .prl-worktrees directory exists
PRL_DIR=$(ensure_prl_directory "$ROOT")

# Step 5: Generate unique worktree name and branch name
if [ -n "$WORKTREE_NAME" ]; then
  # Explicit worktree name provided
  WORKTREE_NAME=$(sanitize_segment "$WORKTREE_NAME")
  WORKTREE_PATH="$PRL_DIR/$WORKTREE_NAME"
  
  # Check if worktree directory already exists
  if [ -d "$WORKTREE_PATH" ]; then
    echo "Error: Worktree directory '.prl-worktrees/$WORKTREE_NAME' already exists. Choose a different name." >&2
    exit 1
  fi
  
  # Branch name is auto-incremented based on agent name
  BRANCH_NAME=$(find_available_branch_name "$ROOT" "$AGENT_NAME")
else
  # Default: use agent name for both worktree and branch
  BASE_NAME=$(sanitize_segment "$AGENT_NAME")
  BASE_NAME=${BASE_NAME:-agent}
  WORKTREE_NAME=$(find_available_worktree_name "$ROOT" "$PRL_DIR" "$BASE_NAME")
  BRANCH_NAME=$(build_branch_name "$WORKTREE_NAME")
  
  if [ "$WORKTREE_NAME" != "$BASE_NAME" ]; then
    echo "Worktree name conflict detected—using $WORKTREE_NAME instead of $BASE_NAME."
  fi
fi

WORKTREE_PATH="$PRL_DIR/$WORKTREE_NAME"

# Initialize template directory if needed (only once, when empty)
# Template is created/checked once per repo, then reused for all worktrees
TEMPLATE_PATH=$(ensure_template_directory "$ROOT")
# Count files in template directory - if 0, initialize from main
# This ensures we only initialize once, even if script is run multiple times
TEMPLATE_FILES=$(find "$TEMPLATE_PATH" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
if [ "$TEMPLATE_FILES" -eq 0 ]; then
  initialize_template_from_main "$ROOT" "$TEMPLATE_PATH"
fi

# Step 6: Create git worktree (with signal handling)
cleanup_on_signal() {
  echo "" >&2
  echo "Worktree creation interrupted. Cleaning up partial state..." >&2
  
  # Try to remove worktree if it was created
  if [ -d "$WORKTREE_PATH" ]; then
    git -C "$ROOT" worktree remove --force "$WORKTREE_PATH" 2>/dev/null || true
  fi
  
  # Try to delete branch if it was created
  if branch_exists "$ROOT" "$BRANCH_NAME"; then
    git -C "$ROOT" branch -D "$BRANCH_NAME" 2>/dev/null || true
  fi
  
  echo "Cleaned up partial state." >&2
  exit 1
}

trap cleanup_on_signal SIGINT SIGTERM

# Create worktree and branch
git -C "$ROOT" worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" HEAD

# Remove signal handler after successful creation
trap - SIGINT SIGTERM

# Copy template files to new worktree
copy_template_to_worktree "$TEMPLATE_PATH" "$WORKTREE_PATH"

# Step 7: Run npm install (non-blocking)
if [ -f "$WORKTREE_PATH/package.json" ]; then
  echo "Running npm install inside the agent worktree..."
  if ! (cd "$WORKTREE_PATH" && npm install); then
    echo "Warning: npm install failed inside the agent worktree—continuing with shell startup." >&2
  fi
fi

# Output worktree info to stderr (for Node.js to parse, separate from agent output)
echo "WORKTREE_INFO_START" >&2
echo "AGENT=$AGENT_NAME" >&2
echo "WORKTREE_NAME=$WORKTREE_NAME" >&2
echo "BRANCH_NAME=$BRANCH_NAME" >&2
echo "WORKTREE_PATH=$WORKTREE_PATH" >&2
echo "ROOT=$ROOT" >&2
echo "WORKTREE_INFO_END" >&2

# Step 8: Execute agent command (if provided)
if [ ${#AGENT_ARGS[@]} -gt 0 ] || [ -n "$AGENT_NAME" ]; then
  AGENT_CMD="$AGENT_NAME"
  if [ ${#AGENT_ARGS[@]} -gt 0 ]; then
    echo "Running agent command: $AGENT_CMD ${AGENT_ARGS[*]}"
  else
    echo "Running agent command: $AGENT_CMD"
  fi
  
  # Run agent in worktree directory
  # Use ${AGENT_ARGS[@]+"${AGENT_ARGS[@]}"} to handle empty array with set -u
  if [ ${#AGENT_ARGS[@]} -gt 0 ]; then
    if ! (cd "$WORKTREE_PATH" && "$AGENT_CMD" "${AGENT_ARGS[@]}"); then
      echo "Agent command $AGENT_CMD failed; you can recover inside $WORKTREE_PATH." >&2
    fi
  else
    if ! (cd "$WORKTREE_PATH" && "$AGENT_CMD"); then
      echo "Agent command $AGENT_CMD failed; you can recover inside $WORKTREE_PATH." >&2
    fi
  fi
fi

# Step 9: Open interactive shell (TTY-only)
# Note: This is handled by Node.js wrapper for better TTY detection
# But we output the worktree path so Node.js can spawn the shell
echo "SHELL_READY" >&2
echo "WORKTREE_PATH=$WORKTREE_PATH" >&2

