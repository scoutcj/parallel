# E2E Test Suite

This directory contains end-to-end tests for `git-prl`.

## Running Tests

```bash
# Run all tests
npm run test:e2e

# Run only start command tests
npm run test:e2e:start

# Run only apply command tests
npm run test:e2e:apply
```

## Test Structure

### `e2e/setup.ts`
Test infrastructure utilities:
- `createTestRepo()` - Creates isolated git repositories for testing
- `createMockAgent()` - Creates a mock agent command for testing
- `createTestPackageJson()` - Creates test package.json files
- `createTestEnvFile()` - Creates test .env files
- `runGitPrl()` - Executes git-prl commands in test environment
- Helper functions for checking worktrees, branches, files, etc.

### `e2e/start.test.ts`
Tests for `git prl <agent>` command:
1. **should create worktree and branch** - Verifies worktree and branch creation
2. **should copy .env file to worktree** - Verifies .env file is copied from template
3. **should run npm install in worktree** - Verifies npm install runs in worktree
4. **should create unique branch names on conflict** - Verifies auto-increment on conflicts
5. **should copy multiple template files** - Verifies all template files are copied

### `e2e/apply.test.ts`
Tests for `git prl apply` command:
1. **should successfully merge prl branch into main** - Verifies successful merge with file changes
2. **should handle merge conflicts gracefully** - Verifies conflict detection and error handling
3. **should fail if not in prl branch** - Verifies error when run from non-prl branch
4. **should fail if already on main branch** - Verifies error when already on main
5. **should preserve worktree after successful merge (no cleanup)** - Verifies worktree remains after merge
6. **should merge multiple commits from prl branch** - Verifies multiple commits are merged correctly

## Test Environment

Tests run in isolated temporary directories that are cleaned up after each test. The test runner:
- Creates a mock agent command in a temporary bin directory
- Sets up isolated git repositories
- Runs git-prl commands in non-interactive mode (non-TTY)
- Verifies expected behavior
- Cleans up all temporary files

## Adding New Tests

To add a new test:

```typescript
test("test name", async () => {
  currentRepo = createTestRepo("test-name");
  // ... setup ...
  await runGitPrl(currentRepo.path, ["command", "args"]);
  // ... assertions ...
});
```

