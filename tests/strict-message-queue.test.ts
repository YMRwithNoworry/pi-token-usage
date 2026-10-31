/**
 * Runtime checks for the strict Tab message queue.
 *
 * Run with: node --experimental-strip-types tests/strict-message-queue.test.ts
 * (jiti resolves the extension's TypeScript imports exactly as Pi loads them)
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JITI_PATH = "C:/Users/Administrator/.pi/agent/install/releases/1.4.0/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(JITI_PATH);

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { registerStrictMessageQueue } = await jiti.import("../internal/strict-message-queue.ts");

type Handler = (event: any, ctx: any) => unknown;

function createHarness() {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, any>();
  const sent: any[] = [];
  const notices: string[] = [];
  let idle = true;
  let inputListener: ((data: string) => any) | undefined;
  let editorText = "";
  let widget: any;
  let widgetOptions: any;

  const theme = { fg: (_color: string, text: string) => text };

  const ctx = {
    mode: "tui",
    hasUI: true,
    isIdle: () => idle,
    ui: {
      theme,
      setStatus: () => {},
      setWidget: (key: string, content: any, options?: any) => {
        if (key === "strict-message-queue") {
          widget = content;
          widgetOptions = options;
        }
      },
      getEditorText: () => editorText,
      setEditorText: (text: string) => {
        editorText = text;
      },
      onTerminalInput: (handler: (data: string) => any) => {
        inputListener = handler;
        return () => {
          inputListener = undefined;
        };
      },
      notify: (message: string) => notices.push(message),
      editor: async (_title: string, _prefill?: string): Promise<string | undefined> => undefined,
      select: async () => undefined,
    },
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
    sendUserMessage(content: any) {
      sent.push(content);
      // A real run keeps Pi busy until it settles.
      idle = false;
    },
  };

  registerStrictMessageQueue(pi as any);

  const emit = async (event: string) => {
    for (const handler of handlers.get(event) ?? []) await handler({ type: event }, ctx);
  };

  return {
    commands,
    sent,
    notices,
    ctx,
    theme,
    emit,
    /** Simulate a run already in flight. */
    busy: async () => {
      idle = false;
      await emit("agent_start");
    },
    /** Simulate the end of a fully settled run (no retry/continuation pending). */
    settled: async () => {
      idle = true;
      await emit("agent_settled");
    },
    pressTab: () => inputListener?.("\t"),
    getEditorText: () => editorText,
    setEditorText: (text: string) => {
      editorText = text;
    },
    getWidget: () => widget,
    getWidgetOptions: () => widgetOptions,
    enqueue(text: string) {
      editorText = text;
      inputListener?.("\t");
    },
  };
}

function widgetInstance(harness: ReturnType<typeof createHarness>) {
  const factory = harness.getWidget();
  assert.equal(typeof factory, "function", "queue widget factory must be installed");
  return factory({ requestRender: () => {} }, harness.theme);
}

function renderWidget(harness: ReturnType<typeof createHarness>): string[] {
  const factory = harness.getWidget();
  if (typeof factory !== "function") return [];
  return factory({ requestRender: () => {} }, harness.theme).render(80);
}

function click(x: number, y: number, width = 80) {
  return {
    type: "click" as const,
    button: "left" as const,
    x,
    y,
    screenX: x,
    screenY: y,
    width,
    height: 6,
    shift: false,
    alt: false,
    ctrl: false,
  };
}

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

test("Tab queues instead of steering while a run is in flight", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  await harness.busy();

  harness.setEditorText("第一条");
  assert.deepEqual(harness.pressTab(), { consume: true });
  assert.equal(harness.getEditorText(), "");
  assert.equal(harness.sent.length, 0, "queued message must not be sent while busy");
  assert.ok(harness.getWidget(), "queue widget should be rendered");
});

test("Tab while idle sends immediately", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  harness.enqueue("立刻发送");
  assert.deepEqual(harness.sent, ["立刻发送"]);
});

test("Tab on a slash command keeps Pi autocomplete behavior", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  await harness.busy();
  harness.setEditorText("  /goal st");
  assert.equal(harness.pressTab(), undefined);
  assert.equal(harness.getEditorText(), "  /goal st");
  assert.equal(harness.sent.length, 0);
});

test("Tab still sends ordinary text that mentions a slash command", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  harness.enqueue("请执行 /goal status");
  assert.deepEqual(harness.sent, ["请执行 /goal status"]);
});

test("Tab on an empty editor does nothing", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  assert.equal(harness.pressTab(), undefined);
  assert.equal(harness.getWidget(), undefined);
});

test("queued messages send strictly one per settled run, in order", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  await harness.busy();

  for (const text of ["A", "B", "C"]) harness.enqueue(text);
  assert.deepEqual(harness.sent, []);

  await harness.emit("agent_end");
  assert.deepEqual(harness.sent, [], "agent_end is not the strict queue release signal");

  await harness.settled();
  assert.deepEqual(harness.sent, ["A"]);

  // Sending started a new run, so another settle cannot release the next message.
  await harness.emit("agent_settled");
  assert.deepEqual(harness.sent, ["A"]);

  await harness.busy();
  await harness.settled();
  assert.deepEqual(harness.sent, ["A", "B"]);

  await harness.busy();
  await harness.settled();
  assert.deepEqual(harness.sent, ["A", "B", "C"]);

  await harness.busy();
  await harness.settled();
  assert.deepEqual(harness.sent, ["A", "B", "C"]);
  assert.equal(harness.getWidget(), undefined, "widget is removed once the queue drains");
});

test("queue widget lists numbered entries with edit and delete buttons", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  await harness.busy();
  harness.enqueue("第一条消息");
  harness.enqueue("第二条消息");

  const lines = renderWidget(harness);
  assert.deepEqual(harness.getWidgetOptions(), { placement: "aboveEditor" });
  assert.ok(lines[0]?.includes("严格队列"), `header missing: ${lines[0]}`);
  assert.ok(lines[1]?.includes("1. 第一条消息"), `row1: ${lines[1]}`);
  assert.ok(lines[2]?.includes("2. 第二条消息"), `row2: ${lines[2]}`);
  assert.ok(lines[1]?.includes("[编辑]"));
  assert.ok(lines[1]?.includes("[删除]"));
});

test("clicking delete removes only that queued message", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  await harness.busy();
  harness.enqueue("保留");
  harness.enqueue("删除我");

  const instance = widgetInstance(harness);
  const rendered = instance.render(80);
  const deleteColumn = 80 - 2; // inside the trailing [删除] button
  assert.deepEqual(instance.handleMouse(click(deleteColumn, 2)), { handled: true, render: true });
  assert.equal(rendered.length > 0, true);

  const after = renderWidget(harness);
  assert.ok(after[1]?.includes("保留"));
  assert.ok(!after.some((line) => line.includes("删除我")));
});

test("clicking edit opens the item editor", async () => {
  const harness = createHarness();
  let editedPrefill: string | undefined;
  harness.ctx.ui.editor = async (_title: string, prefill?: string) => {
    editedPrefill = prefill;
    return "改写后的文本";
  };
  await harness.emit("session_start");
  await harness.busy();
  harness.enqueue("原始文本");

  const instance = widgetInstance(harness);
  const editColumn = 80 - 12; // inside the leading [编辑] button
  assert.deepEqual(instance.handleMouse(click(editColumn, 1)), { handled: true, render: true });
  assert.equal(editedPrefill, "原始文本");
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(renderWidget(harness)[1]?.includes("改写后的文本"));
});

test("/queue clear empties the queue and removes the widget", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  await harness.busy();
  harness.enqueue("清空我");
  await harness.commands.get("queue").handler("clear", harness.ctx);
  assert.equal(harness.getWidget(), undefined);
  assert.ok(harness.notices.some((notice) => notice.includes("已清空")));
});

test("session shutdown drops the widget and listener", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  await harness.busy();
  harness.enqueue("关掉");
  await harness.emit("session_shutdown");
  assert.equal(harness.getWidget(), undefined);
  assert.equal(harness.pressTab(), undefined);
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
