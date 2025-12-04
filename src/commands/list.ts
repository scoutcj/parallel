import {execa} from "execa";
import {getScriptPath} from "../utils/scripts";

export async function listAgents(): Promise<void> {
  const scriptPath = getScriptPath("prl-list.sh");
  
  // Run bash script and display output
  await execa("bash", [scriptPath], {
    stdio: "inherit"
  });
}
