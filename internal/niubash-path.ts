import { statSync } from "node:fs";
import { basename, delimiter, join } from "node:path";

const NIUBASH_EXECUTABLE = "niu.exe";

type Environment = Record<string, string | undefined>;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function environmentValue(env: Environment, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

function unquote(path: string): string {
  return path.trim().replace(/^"(.*)"$/u, "$1");
}

export function findNiubashPath(env: Environment = process.env): string {
  for (const variable of ["NIU_SHELL", "NIUBASH_PATH"]) {
    const configuredPath = environmentValue(env, variable);
    if (!configuredPath) continue;
    const path = unquote(configuredPath);
    if (basename(path).toLowerCase() === NIUBASH_EXECUTABLE && isFile(path)) return path;
  }

  const localAppData = environmentValue(env, "LOCALAPPDATA");
  if (localAppData) {
    const path = join(localAppData, "Programs", "Niubash", NIUBASH_EXECUTABLE);
    if (isFile(path)) return path;
  }

  for (const entry of (environmentValue(env, "PATH") ?? "").split(delimiter)) {
    const directory = unquote(entry);
    if (!directory) continue;
    const path = join(directory, NIUBASH_EXECUTABLE);
    if (isFile(path)) return path;
  }

  throw new Error("Niubash was not found. Install Niubash, add niu.exe to PATH, or set NIUBASH_PATH to its full path.");
}
