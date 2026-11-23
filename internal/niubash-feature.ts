import {
  createBashTool,
  createLocalBashOperations,
  type BashOperations,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { findNiubashPath } from "./niubash-path.ts";

export { findNiubashPath } from "./niubash-path.ts";

type BashExecOptions = Parameters<BashOperations["exec"]>[2];
type BashExecResult = Awaited<ReturnType<BashOperations["exec"]>>;

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
