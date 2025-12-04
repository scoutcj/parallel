/**
 * Worktree types and minimal utilities
 * Most worktree operations are now handled by bash scripts
 */

export interface WorktreeDescriptor {
  agent: string;
  branchName: string;
  worktreeName: string;
  worktreePath: string;
  root: string;
}
