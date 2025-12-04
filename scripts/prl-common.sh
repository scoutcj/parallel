#!/bin/bash
# Common helper functions for git-prl scripts

set -euo pipefail

# Get repository root (works even from within a worktree)
get_repo_root() {
  git rev-parse --git-common-dir | xargs dirname
}

# Sanitize a string for use in worktree/branch names
sanitize_segment() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/^-\+//' | sed 's/-\+$//' | sed 's/-\+/-/g'
}

# Check if a branch exists
branch_exists() {
  local root="$1"
  local branch_name="$2"
  git -C "$root" branch --list "$branch_name" | grep -q .
}

# Build branch name from worktree name
build_branch_name() {
  local worktree_name="$1"
  echo "prl/$worktree_name"
}

# Find available branch name (auto-increment)
find_available_branch_name() {
  local root="$1"
  local agent="$2"
  local agent_segment
  agent_segment=$(sanitize_segment "$agent")
  agent_segment=${agent_segment:-agent}
  
  local counter=1
  local branch_name="prl/${agent_segment}-${counter}"
  
  while branch_exists "$root" "$branch_name"; do
    counter=$((counter + 1))
    branch_name="prl/${agent_segment}-${counter}"
  done
  
  if [ "$counter" -gt 1 ]; then
    echo "Branch name conflict detected—using $branch_name instead of prl/${agent_segment}-1." >&2
  fi
  
  echo "$branch_name"
}

# Find available worktree name (auto-increment)
find_available_worktree_name() {
  local root="$1"
  local prl_dir="$2"
  local base_name="$3"
  
  local candidate="$base_name"
  local counter=1
  
  while [ -d "$prl_dir/$candidate" ] || branch_exists "$root" "$(build_branch_name "$candidate")"; do
    candidate="${base_name}-${counter}"
    counter=$((counter + 1))
  done
  
  echo "$candidate"
}

# Ensure .prl-worktrees directory exists
ensure_prl_directory() {
  local root="$1"
  local prl_dir="$root/.prl-worktrees"
  mkdir -p "$prl_dir"
  echo "$prl_dir"
}

# Ensure template directory exists (idempotent - safe to call multiple times)
ensure_template_directory() {
  local root="$1"
  local prl_dir
  prl_dir=$(ensure_prl_directory "$root")
  local template_path="$prl_dir/template"
  mkdir -p "$template_path"  # mkdir -p is idempotent - does nothing if already exists
  echo "$template_path"
}

# Initialize template from main worktree
initialize_template_from_main() {
  local root="$1"
  local template_path="$2"
  
  local files_to_copy=(
    ".env"
    ".env.local"
    ".env.development"
    ".env.production"
    ".env.test"
    "package.json"
    "package-lock.json"
    ".eslintrc"
    ".eslintrc.js"
    ".eslintrc.json"
    ".eslintrc.yaml"
    ".eslintrc.yml"
    ".prettierrc"
    ".prettierrc.js"
    ".prettierrc.json"
    ".prettierignore"
    "tsconfig.json"
    ".gitignore"
  )
  
  local copied_count=0
  for file in "${files_to_copy[@]}"; do
    local source_path="$root/$file"
    if [ -f "$source_path" ]; then
      if cp "$source_path" "$template_path/$file" 2>/dev/null; then
        copied_count=$((copied_count + 1))
      else
        echo "Warning: Failed to copy $file to template" >&2
      fi
    fi
  done
  
  if [ "$copied_count" -gt 0 ]; then
    echo "Initialized worktree template with $copied_count file(s) from main worktree."
  fi
}

# Copy template files to worktree
copy_template_to_worktree() {
  local template_path="$1"
  local worktree_path="$2"
  
  if [ ! -d "$template_path" ]; then
    return 0
  fi
  
  local copied_count=0
  while IFS= read -r -d '' file; do
    local rel_path="${file#$template_path/}"
    local dest_path="$worktree_path/$rel_path"
    local dest_dir
    dest_dir=$(dirname "$dest_path")
    
    # Create destination directory if needed
    mkdir -p "$dest_dir"
    
    if [ -f "$file" ]; then
      if cp "$file" "$dest_path" 2>/dev/null; then
        copied_count=$((copied_count + 1))
      else
        echo "Warning: Failed to copy template file $rel_path" >&2
      fi
    fi
  done < <(find "$template_path" -type f -print0 2>/dev/null || true)
  
  if [ "$copied_count" -gt 0 ]; then
    echo "Copied $copied_count template file(s) to worktree."
  fi
}

# Remove worktree and branch
remove_worktree() {
  local root="$1"
  local worktree_path="$2"
  local branch_name="$3"
  
  # Remove worktree (ignore errors)
  git -C "$root" worktree remove --force "$worktree_path" 2>/dev/null || true
  
  # Delete branch (ignore errors)
  git -C "$root" branch -D "$branch_name" 2>/dev/null || true
}

# List all prl worktrees
list_worktrees() {
  local root="$1"
  local prl_dir="$root/.prl-worktrees"
  
  if [ ! -d "$prl_dir" ]; then
    return 0
  fi
  
  find "$prl_dir" -mindepth 1 -maxdepth 1 -type d ! -name template -exec basename {} \;
}

# Get worktree descriptor by branch name
get_worktree_by_branch() {
  local root="$1"
  local branch_name="$2"
  local prl_dir="$root/.prl-worktrees"
  
  if [ ! -d "$prl_dir" ]; then
    return 1
  fi
  
  # Find worktree directory that matches the branch name pattern
  local worktree_name="${branch_name#prl/}"
  local worktree_path="$prl_dir/$worktree_name"
  
  if [ -d "$worktree_path" ]; then
    echo "$worktree_name|$worktree_path|$branch_name"
    return 0
  fi
  
  return 1
}

# Update base branch from remote
update_base_branch_from_remote() {
  local root="$1"
  local base_branch="$2"
  local remote_branch="$3"
  
  # Fetch latest from remote
  git -C "$root" fetch origin "$base_branch"
  
  # Checkout base branch and merge remote updates
  git -C "$root" checkout "$base_branch"
  git -C "$root" merge "$remote_branch"
}

# Merge prl branch into base branch
merge_prl_branch() {
  local root="$1"
  local current_branch="$2"
  local base_branch="$3"
  
  # Switch to base branch
  git -C "$root" checkout "$base_branch"
  
  # Merge with --no-ff to create merge commit
  git -C "$root" merge --no-ff "$current_branch"
}

