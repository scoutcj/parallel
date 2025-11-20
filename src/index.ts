import {Command} from "commander";
import {startAgent} from "./commands/start";
import {applyAgent} from "./commands/apply";
import {listAgents} from "./commands/list";
import {pruneWorktrees} from "./commands/prune";

const program = new Command();

program
  .name("git prl")
  .description("Run parallel agents each in their own git worktree")
  .argument("<agent>", "Name of the agent to run")
  .option("-w, --worktree <name>", "Explicitly name the worktree directory")
  .hook("preAction", () => {
    // noop placeholder for future globals
  });

program.allowUnknownOption(true);

program
  .command("apply")
  .description("Merge the current agent branch into main and optionally clean up")
  .option("--auto-cleanup", "Automatically delete worktree after successful merge")
  .action(async (options) => {
    await applyAgent(options.autoCleanup);
  });

program
  .command("list")
  .description("List active prl worktrees")
  .action(async () => {
    await listAgents();
  });

program
  .command("prune")
  .description("Prompt to remove stale prl worktrees")
  .action(async () => {
    await pruneWorktrees();
  });

program.action(async (agentName: string) => {
  if (!agentName) {
    program.outputHelp();
    process.exit(1);
  }

  // Parse arguments: everything before agent name = git prl flags, everything after = agent args
  const rawArgs = process.argv.slice(2);
  
  // Find where agent name appears in args (could be after flags like --worktree)
  let agentIndex = -1;
  for (let i = 0; i < rawArgs.length; i++) {
    // Skip known flags and their values
    if (rawArgs[i] === "-w" || rawArgs[i] === "--worktree") {
      i++; // Skip the flag value
      continue;
    }
    if (rawArgs[i] === agentName) {
      agentIndex = i;
      break;
    }
  }
  
  if (agentIndex === -1) {
    // Shouldn't happen, but handle gracefully
    program.outputHelp();
    process.exit(1);
  }
  
  // Everything after agent name is passed to the agent
  const agentArgs = rawArgs.slice(agentIndex + 1);

  const options = program.opts();
  await startAgent(agentName, {
    worktreeName: options.worktree,
    agentArgs
  });
});

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

