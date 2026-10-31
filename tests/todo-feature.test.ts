/**
 * Runtime checks for the Codex-style task plan tool and session state.
 *
 * Run with: node --experimental-strip-types tests/todo-feature.test.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JITI_PATH = "C:/Users/Administrator/.pi/agent/install/releases/1.4.0/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(JITI_PATH);

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { registerCodexTodo } = await jiti.import("../internal/todo-feature.ts");

type Handler = (event: any, ctx: any) => unknown;

function createHarness() {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const entries: any[] = [];
  const notices: Array<{ message: string; type?: string }> = [];
  const statuses: Array<{ key: string; text: string | undefined }> = [];
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      theme,
      notify: (message: string, type?: string) => notices.push({ message, type }),
      setStatus: (key: string, text: string | undefined) => statuses.push({ key, text }),
    },
    sessionManager: { getBranch: () => entries },
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
      entries.push({ type: "custom", customType: type, data });
    },
  };

  registerCodexTodo(pi as any);
  const emit = async (event: string) => {
    for (const handler of handlers.get(event) ?? []) await handler({ type: event }, ctx);
  };
  return { commands, tools, entries, notices, statuses, ctx, emit, handlers };
}

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

const initialPlan = [
  { step: "Inspect current implementation", status: "completed" },
  { step: "Add the task plan tool", status: "in_progress" },
  { step: "Run regression tests", status: "pending" },
];

test("registers the Codex update_plan tool and user commands", () => {
  const harness = createHarness();
  assert.ok(harness.tools.has("update_plan"));
  assert.ok(harness.commands.has("plan"));
  assert.ok(harness.commands.has("todo"));
  assert.ok(harness.commands.has("todos"));
});

test("updates the ordered plan, persists it, and renders current progress", async () => {
  const harness = createHarness();
  const result = await harness.tools.get("update_plan").execute("call-1", { plan: initialPlan }, undefined, undefined, harness.ctx);

  assert.equal(result.isError, false);
  assert.equal(result.details.plan.length, 3);
  assert.match(result.content[0].text, /Plan \(1\/3 completed\)/u);
  assert.equal(harness.entries.length, 1);
  assert.deepEqual(harness.entries[0].data, { version: 1, plan: initialPlan });
  assert.match(harness.statuses.at(-1).text, /Plan 1\/3 · Add the task plan tool/u);

  await harness.commands.get("plan").handler("show", harness.ctx);
  assert.match(harness.notices.at(-1).message, /\[>\] 2\. Add the task plan tool/u);
});

test("injects the active checklist into the next model turn", async () => {
  const harness = createHarness();
  await harness.tools.get("update_plan").execute("call-1", { plan: initialPlan }, undefined, undefined, harness.ctx);
  const event = { systemPromptOptions: { sections: {} } };
  for (const handler of harness.handlers.get("before_agent_start") ?? []) await handler(event, harness.ctx);

  assert.match(event.systemPromptOptions.sections.codex_style_todo_plan, /<step status="in_progress">Add the task plan tool<\/step>/u);
});
test("restores the latest plan on the selected session branch", async () => {
  const harness = createHarness();
  harness.entries.push(
    { type: "custom", customType: "codex-style-todo-plan", data: { version: 1, plan: [{ step: "Old branch", status: "in_progress" }] } },
    { type: "custom", customType: "codex-style-todo-plan", data: { version: 1, plan: initialPlan } },
  );

  await harness.emit("session_tree");
  await harness.commands.get("todos").handler("", harness.ctx);

  assert.match(harness.notices.at(-1).message, /Add the task plan tool/u);
  assert.match(harness.statuses.at(-1).text, /Plan 1\/3/u);
});


test("rejects multiple in-progress steps without replacing the saved plan", async () => {
  const harness = createHarness();
  const tool = harness.tools.get("update_plan");
  await tool.execute("call-1", { plan: initialPlan }, undefined, undefined, harness.ctx);
  const invalid = await tool.execute("call-2", {
    plan: [
      { step: "First", status: "in_progress" },
      { step: "Second", status: "in_progress" },
    ],
  }, undefined, undefined, harness.ctx);

  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /at most one in-progress/u);
  assert.equal(harness.entries.length, 1);
  assert.deepEqual(invalid.details.plan, initialPlan);
});

test("rejects empty steps and clears plan state on command", async () => {
  const harness = createHarness();
  const invalid = await harness.tools.get("update_plan").execute("call-1", {
    plan: [{ step: "   ", status: "pending" }],
  }, undefined, undefined, harness.ctx);
  assert.equal(invalid.isError, true);
  assert.equal(harness.entries.length, 0);

  await harness.tools.get("update_plan").execute("call-2", { plan: initialPlan }, undefined, undefined, harness.ctx);
  await harness.commands.get("plan").handler("clear", harness.ctx);
  assert.equal(harness.entries.at(-1).data.plan, null);
  assert.equal(harness.statuses.at(-1).text, undefined);
  assert.match(harness.notices.at(-1).message, /Task plan cleared/u);
});

test("completion only offers plan display and clear commands", async () => {
  const command = createHarness().commands.get("plan");
  assert.deepEqual(command.getArgumentCompletions(""), [
    { value: "show", label: "show" },
    { value: "clear", label: "clear" },
  ]);
  assert.deepEqual(command.getArgumentCompletions("cl"), [{ value: "clear", label: "clear" }]);
  assert.deepEqual(command.getArgumentCompletions("unknown"), []);
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
