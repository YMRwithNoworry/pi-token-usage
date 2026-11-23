import { accessSync, constants, statSync } from "node:fs";
import { basename, delimiter, join } from "node:path";
import {
  createBashTool,
  createLocalBashOperations,
  type BashOperations,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const NIUBASH_EXECUTABLE = "niu.exe";
type BashExecOptions = Parameters<BashOperations["exec"]>[2];
type BashExecResult = Awaited<ReturnType<BashOperations["exec"]>>;

function accessible(path: string): boolean {
  try {
    accessSync(path, constants.F_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function environmentValue(env: Record<string, string | undefined>, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

function unquote(path: string): string {
  return path.trim().replace(/^"(.*)"$/u, "$1");
}

/** Resolve Niubash from its inherited shell path, an explicit override, its standard install, or PATH. */
export function findNiubashPath(env: Record<string, string | undefined> = process.env): string {
  for (const variable of ["NIU_SHELL", "NIUBASH_PATH"]) {
    const configuredPath = environmentValue(env, variable);
    if (!configuredPath) continue;
    const path = unquote(configuredPath);
    if (basename(path).toLowerCase() === NIUBASH_EXECUTABLE && accessible(path)) return path;
  }

  const localAppData = environmentValue(env, "LOCALAPPDATA");
  if (localAppData) {
    const standardPath = join(localAppData, "Programs", "Niubash", NIUBASH_EXECUTABLE);
    if (accessible(standardPath)) return standardPath;
  }

  const pathValue = environmentValue(env, "PATH") ?? "";
  for (const entry of pathValue.split(delimiter)) {
    const directory = unquote(entry);
    if (!directory) continue;
    const candidate = join(directory, NIUBASH_EXECUTABLE);
    if (accessible(candidate)) return candidate;
  }

  throw new Error("Niubash was not found. Install Niubash, add niu.exe to PATH, or set NIUBASH_PATH to its full path.");
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

export function registerNiubash(pi: ExtensionAPI, platform: string = process.platform): void {
  if (platform !== "win32") return;

  const bash = createBashTool(process.cwd(), { operations: createNiubashOperations() });
  pi.registerTool({
    ...bash,
    description: `${bash.description} The Bash backend is Niubash.`,
    promptSnippet: "Execute Bash commands using Niubash on Windows",
    promptGuidelines: [
      ...(bash.promptGuidelines ?? []),
      "Use Niubash-compatible Bash syntax and native Windows paths.",
    ],
  });
}

export default registerNiubash;
