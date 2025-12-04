import {join} from "path";

/**
 * Get the path to the scripts directory
 * Works both in development and when installed as npm package
 */
export function getScriptsPath(): string {
  // When installed as npm package, scripts are at package root
  // In development, we're in dist/utils, so go up to project root
  // Try to find scripts relative to this file's location
  const distPath = __dirname; // dist/utils or dist/commands
  const projectRoot = join(distPath, "..", "..");
  const scriptsPath = join(projectRoot, "scripts");
  
  // If scripts don't exist at that path, try package root (when installed)
  // For now, assume scripts are always at projectRoot/scripts
  return scriptsPath;
}

/**
 * Get the full path to a bash script
 */
export function getScriptPath(scriptName: string): string {
  return join(getScriptsPath(), scriptName);
}

