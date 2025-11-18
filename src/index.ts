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
  .option("-n, --name <suffix>", "Add a suffix to the agent branch/worktree name")
  .hook("preAction", () => {
    // noop placeholder for future globals
  });

program
  .command("apply")
  .description("Merge the current agent branch into main and optionally clean up")
  .action(async () => {
    await applyAgent();
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

  const options = program.opts();
  await startAgent(agentName, {
    suffix: options.name
  });
});

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

