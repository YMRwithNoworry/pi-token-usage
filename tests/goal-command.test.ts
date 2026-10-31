/**
 * Runtime checks for direct /goal creation and argument completion.
 *
 * Run with: node --experimental-strip-types tests/goal-command.test.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JITI_PATH = "C:/Users/Administrator/.pi/agent/install/releases/1.4.0/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(JITI_PATH);

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { registerPersistentGoals } = await jiti.import("../internal/goal-feature.ts");

type Handler = (event: any, ctx: any) => unknown;

type Harness = ReturnType<typeof createHarness>;

function createHarness() {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const appended: Array<{ type: string; data: any }> = [];
  const sent: Array<{ message: any; options: any }> = [];
  const notices: Array<{ message: string; type?: string }> = [];
  const statuses: Array<{ key: string; text: string | undefined }> = [];
  const branch: any[] = [];

  const ctx = {
    mode: "tui",
    hasUI: true,
    cwd: "D:/code/pi插件",
    isIdle: () => true,
    hasPendingMessages: () => false,
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      setStatus: (key: string, text: string | undefined) => statuses.push({ key, text }),
      notify: (message: string, type?: string) => notices.push({ message, type }),
    },
    sessionManager: { getBranch: () => branch },
  };

  const pi = {
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    },
    registerCommand(name: string, options: any) {
      commands.set(name, options);
    },
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    appendEntry(type: string, data: any) {
      appended.push({ type, data });
      branch.push({ type: "custom", customType: type, data });
    },
    sendMessage(message: any, options: any) {
      sent.push({ message, options });
    },
  };

  registerPersistentGoals(pi as any);

  const emit = async (event: string, payload: Record<string, unknown> = {}) => {
    for (const handler of handlers.get(event) ?? []) await handler({ type: event, ...payload }, ctx);
  };

  return { commands, tools, appended, sent, notices, statuses, branch, ctx, emit, handlers };
}

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

test("/goal <objective> creates a goal and starts a turn", async () => {
  const harness = createHarness();
  await harness.emit("session_start");

  await harness.commands.get("goal").handler("补齐插件回归测试 --budget 2400", harness.ctx);

  const saved = harness.appended.at(-1);
  assert.equal(saved?.type, "pi-persistent-goal");
  assert.equal(saved?.data.goal.objective, "补齐插件回归测试");
  assert.equal(saved?.data.goal.status, "active");
  assert.equal(saved?.data.goal.tokenBudget, 2400);
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0]?.options.triggerTurn, true);
  assert.equal(harness.sent[0]?.message.display, false);
  assert.ok(harness.notices.some((notice) => notice.message.includes("Goal started")));
});

test("/goal completion only suggests reserved commands and budgets", async () => {
  const harness = createHarness();
  const command = harness.commands.get("goal");
  assert.ok(command);

  assert.deepEqual(await command.getArgumentCompletions("res"), [{ value: "resume", label: "resume" }]);
  assert.deepEqual(await command.getArgumentCompletions("budget "), [
    { value: "none", label: "none" },
    { value: "10000", label: "10000" },
    { value: "50000", label: "50000" },
    { value: "100000", label: "100000" },
  ]);
  assert.equal(await command.getArgumentCompletions("build a feature"), null);
});

test("continues a completed turn even when no context is otherwise runnable", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  await harness.commands.get("goal").handler("finish the requested implementation", harness.ctx);
  harness.sent.length = 0;

  const settleHandlers = harness.handlers.get("agent_before_settle") ?? [];
  assert.equal(settleHandlers.length, 1);
  const result = await settleHandlers[0]({
    type: "agent_before_settle",
    outcome: "completed",
    entries: [],
    continue: false,
    context: {
      contextEntries: [],
      contextMessages: [],
      llmMessages: [{ role: "assistant", content: "done" }],
      pendingMessages: [],
      canContinue: false,
    },
  }, harness.ctx);

  assert.equal(result?.continue, true);
  assert.equal(result?.entries?.length, 1);
  assert.equal(result?.entries?.[0]?.type, "custom_message");
  assert.equal(result?.entries?.[0]?.customType, "pi-persistent-goal-continuation");
});

test("legacy /goal start syntax remains compatible", async () => {
  const harness = createHarness();
  await harness.emit("session_start");

  await harness.commands.get("goal").handler("start --budget=9000 keep the existing objective", harness.ctx);

  assert.equal(harness.appended.at(-1)?.data.goal.objective, "keep the existing objective");
  assert.equal(harness.appended.at(-1)?.data.goal.tokenBudget, 9000);
  assert.equal(harness.sent.length, 1);
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures++;
    console.error(`not ok - ${name}`);
    console.error(error instanceof Error ? error.stack : error);
  }
}

if (failures > 0) {
  console.error(`\n${failures}/${tests.length} failed`);
  process.exit(1);
}
console.log(`\n${tests.length}/${tests.length} passed`);
