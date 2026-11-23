import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { resolve } from "node:path";
import { findNiubashPath } from "../internal/niubash-path.ts";

const DEFAULT_TIMEOUT_SECONDS = 300;
const MAX_OUTPUT_BYTES = 50 * 1024;

export function registerNiubash(pi: ExtensionAPI, platform: string = process.platform): void {
  if (platform !== "win32") return;

  const z = pi.zod;
  pi.registerTool({
    name: "bash",
    label: "Bash (Niubash)",
    description: "Run a non-interactive Bash command through Niubash on Windows. Use native Windows paths.",
    loadMode: "essential",
    parameters: z.object({
      command: z.string().describe("Bash command to execute"),
      cwd: z.string().optional().describe("Working directory, relative to the session directory unless absolute"),
      timeout: z.number().min(0).max(2_147_483).optional().describe("Timeout in seconds; defaults to 300, 0 disables it"),
    }),
    async execute(_id, { command, cwd, timeout = DEFAULT_TIMEOUT_SECONDS }, signal, _onUpdate, ctx) {
      const result = await pi.exec(findNiubashPath(), ["-c", command], {
        cwd: cwd ? resolve(ctx.cwd, cwd) : ctx.cwd,
        timeout: timeout > 0 ? Math.max(1, Math.floor(timeout * 1000)) : undefined,
        signal,
      });
      const output = Buffer.from([result.stdout, result.stderr].filter(Boolean).join("\n"));
      const truncated = output.length > MAX_OUTPUT_BYTES;
      const text = output.subarray(-MAX_OUTPUT_BYTES).toString("utf8");
      const footer = result.killed
        ? signal?.aborted ? "Command cancelled." : "Command timed out."
        : result.code !== 0 ? `Command exited with code ${result.code}.` : "";
      return {
        content: [{ type: "text", text: [truncated ? "[Output truncated to the last 50 KiB]" : "", text, footer].filter(Boolean).join("\n") || "(no output)" }],
        details: { exitCode: result.code, truncated },
        isError: result.killed || result.code !== 0,
      };
    },
  });
}
