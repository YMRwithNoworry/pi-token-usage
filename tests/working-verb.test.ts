/**
 * Runtime checks for the rotating Chinese working verbs.
 *
 * Run with: node --experimental-strip-types tests/working-verb.test.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JITI_PATH = "C:/Users/Administrator/.pi/agent/install/releases/1.4.0/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(JITI_PATH);

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { registerWorkingVerbs } = await jiti.import("../internal/working-verb.ts");

type Handler = (event: any, ctx: any) => unknown;

function createHarness() {
  const handlers = new Map<string, Handler[]>();
  const workingMessages: Array<string | undefined> = [];
  const statuses: Array<string | undefined> = [];
  const indicators: Array<unknown> = [];

  const ctx = {
    mode: "tui",
    hasUI: true,
    isIdle: () => false,
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      setStatus: (_key: string, text: string | undefined) => statuses.push(text),
      setWorkingMessage: (message?: string) => workingMessages.push(message),
      setWorkingIndicator: (options?: unknown) => indicators.push(options),
      setWorkingVisible: () => {},
    },
  };

  const pi = {
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    },
  };

  registerWorkingVerbs(pi as any);

  const emit = async (event: string, payload: Record<string, unknown> = {}) => {
    for (const handler of handlers.get(event) ?? []) await handler({ type: event, ...payload }, ctx);
  };

  return { emit, workingMessages, statuses, indicators };
}

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

test("session_start loads verbs and hides the default spinner", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  assert.ok(harness.workingMessages.length >= 1, "a verb should be shown on session start");
  assert.deepEqual(harness.indicators[0], { frames: [""] });
  const first = harness.workingMessages[0];
  assert.equal(typeof first, "string");
  assert.ok((first ?? "").length > 0);
  assert.ok(harness.statuses[0] === first, "status line mirrors the working message");
});

test("turn_start and streaming events rotate the verb", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  const before = harness.workingMessages.at(-1);

  await harness.emit("turn_start");
  const afterTurn = harness.workingMessages.at(-1);
  assert.ok(afterTurn && afterTurn.length > 0);
  assert.notEqual(afterTurn, before, "turn_start must change the verb");

  await harness.emit("message_start", { message: { role: "assistant" } });
  await harness.emit("message_update", { assistantMessageEvent: { type: "thinking_start" } });
  await harness.emit("tool_execution_start");
  await harness.emit("before_provider_request");
  await harness.emit("agent_end");
  // session_start, turn_start, message_start, message_update, tool_execution_start, before_provider_request
  assert.equal(harness.workingMessages.length, 6);
});

test("session_shutdown restores Pi's default working UI", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  await harness.emit("turn_start");
  await harness.emit("session_shutdown");
  assert.equal(harness.workingMessages.at(-1), undefined);
  assert.equal(harness.indicators.at(-1), undefined);
  assert.equal(harness.statuses.at(-1), undefined);
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
