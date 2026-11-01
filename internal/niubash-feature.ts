import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import {
  createBashTool,
  createLocalBashOperations,
  type BashOperations,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const NIUBASH_EXECUTABLE = "niu.exe";
type BashExecOptions = Parameters<BashOperations["exec"]>[2];
type BashExecResult = Awaited<ReturnType<BashOperations["exec"]>>;

const NIUBASH_GUIDELINES = [
  "Commands run in Niubash, a Windows-native Bash-compatible shell, through niu.exe -c.",
  "Use Niubash-compatible Bash syntax and Windows-native paths; do not assume PowerShell, WSL, or Git Bash behavior.",
];

function accessible(path: string): boolean {
  try {
    accessSync(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function findNiubashPath(): string {
  const configuredPath = process.env.NIU_SHELL?.trim();
  if (configuredPath && accessible(configuredPath)) return configuredPath;

  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path");
  const searchPath = pathKey ? process.env[pathKey] ?? "" : "";
  for (const entry of searchPath.split(delimiter)) {
    const directory = entry.trim().replace(/^"(.*)"$/u, "$1");
    if (!directory) continue;
    const candidate = join(directory, NIUBASH_EXECUTABLE);
    if (accessible(candidate)) return candidate;
  }

  throw new Error(
    "Niubash was not found. Start Pi from Niubash or add the directory containing niu.exe to PATH.",
  );
}

function createNiubashOperations(): BashOperations {
  let localOperations: BashOperations | undefined;
  return {
    exec: async (
      command: string,
      cwd: string,
      options: BashExecOptions,
    ): Promise<BashExecResult> => {
      localOperations ??= createLocalBashOperations({ shellPath: findNiubashPath() });
      return localOperations.exec(command, cwd, options);
    },
  };
}

/** Replace only Pi's bash tool backend on Windows; all other built-in tools remain native. */
export function registerNiubashBash(pi: ExtensionAPI): void {
  if (process.platform !== "win32") return;

  const niubashTool = createBashTool(process.cwd(), { operations: createNiubashOperations() });
  pi.registerTool({
    ...niubashTool,
    description: "Execute a command using Niubash, the Windows-native Bash-compatible shell.",
    promptSnippet: "Execute commands using Niubash (Windows-native Bash-compatible shell)",
    promptGuidelines: NIUBASH_GUIDELINES,
  });
}

export default registerNiubashBash;
