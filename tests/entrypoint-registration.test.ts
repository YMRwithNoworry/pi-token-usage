/** Verify the single extension entry point registers each public command and tool once. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JITI_PATH = "C:/Users/Administrator/.pi/agent/install/releases/1.4.0/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(JITI_PATH);
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { default: tokenUsage } = await jiti.import("../token-usage.ts");

const handlers = new Map<string, unknown[]>();
const commands = new Map<string, unknown>();
const tools = new Map<string, unknown>();
const eventHandlers = new Map<string, Set<(data: unknown) => void>>();
const events = {
  on(name: string, handler: (data: unknown) => void) {
    const listeners = eventHandlers.get(name) ?? new Set();
    listeners.add(handler);
    eventHandlers.set(name, listeners);
    return () => listeners.delete(handler);
  },
  emit(name: string, data: unknown) {
    for (const handler of eventHandlers.get(name) ?? []) handler(data);
  },
};
const pi = {
  on(name: string, handler: unknown) {
    handlers.set(name, [...(handlers.get(name) ?? []), handler]);
  },
  registerCommand(name: string, options: unknown) {
    commands.set(name, options);
  },
  registerTool(tool: { name: string }) {
    tools.set(tool.name, tool);
  },
  registerShortcut() {},
  events,
};

tokenUsage(pi as any);

assert.equal(handlers.get("input")?.length, 1, "background message routing must register once");
for (const command of ["goal", "init", "plan", "todo", "todos", "queue"]) {
  assert.equal(commands.has(command), true, `/${command} must register`);
}
for (const tool of ["create_goal", "get_goal", "update_goal", "update_plan", "delegate", "team"]) {
  assert.equal(tools.has(tool), true, `${tool} must register`);
}
assert.equal(tools.has("bash"), process.platform === "win32", "only Windows overrides Pi's native bash tool");
for (const tool of ["read", "edit", "write", "grep", "find", "ls", "powershell"]) {
  assert.equal(tools.has(tool), false, `${tool} must remain a native Pi tool`);
}
console.log("ok - single entry point registers each extension feature and only overrides native bash on Windows");
