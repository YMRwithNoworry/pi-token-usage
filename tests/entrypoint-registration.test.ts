import assert from "node:assert/strict";
import test from "node:test";
import "./pi-host.ts";
const { default: codexStyle } = await import("../token-usage.ts");

test("the extension only registers the strict queue and Windows Bash override", () => {
  const commands: string[] = [];
  const tools: string[] = [];
  const events: string[] = [];
  const pi = {
    registerCommand(name: string): void { commands.push(name); },
    registerTool(tool: { name: string }): void { tools.push(tool.name); },
    on(event: string): void { events.push(event); },
  };

  codexStyle(pi as unknown as Parameters<typeof codexStyle>[0]);

  assert.deepEqual(commands, ["queue"]);
  assert.deepEqual(tools, process.platform === "win32" ? ["bash"] : []);
  assert.deepEqual(events.sort(), ["agent_settled", "agent_start", "session_shutdown", "session_start"]);
});
