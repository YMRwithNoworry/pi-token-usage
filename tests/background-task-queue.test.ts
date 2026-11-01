/**
 * Runtime checks for routing busy TUI submissions to Pi's follow-up queue.
 *
 * Run with: node --experimental-strip-types tests/background-task-queue.test.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JITI_PATH = "C:/Users/Administrator/.pi/agent/install/releases/1.4.0/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(JITI_PATH);

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { registerBackgroundTaskQueue } = await jiti.import("../internal/background-task-queue.ts");

type Handler = (event: any, ctx: any) => unknown;

function createHarness() {
  const handlers: Handler[] = [];
  const sent: Array<{ content: any; options: any }> = [];
  const pi = {
    on(event: string, handler: Handler) {
      if (event === "input") handlers.push(handler);
      return () => {};
    },
    sendUserMessage(content: any, options: any) {
      sent.push({ content, options });
    },
  };
  registerBackgroundTaskQueue(pi as any);

  const input = (event: Record<string, any>, mode = "tui") =>
    handlers.reduce<unknown>((result, handler) => handler({ type: "input", ...event }, { mode }) ?? result, undefined);

  return { input, sent };
}

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

test("busy Enter messages become native follow-ups in submission order", () => {
  const harness = createHarness();
  const first = harness.input({ text: "先完成当前任务", source: "interactive", streamingBehavior: "steer" });
  const second = harness.input({ text: "再处理这个", source: "interactive", streamingBehavior: "steer" });

  assert.deepEqual(first, { action: "handled" });
  assert.deepEqual(second, { action: "handled" });
  assert.deepEqual(harness.sent, [
    { content: "先完成当前任务", options: { deliverAs: "followUp", expandPromptTemplates: true } },
    { content: "再处理这个", options: { deliverAs: "followUp", expandPromptTemplates: true } },
  ]);
});

test("attached images are included in the queued follow-up", () => {
  const harness = createHarness();
  const image = { type: "image", data: "aW1hZ2U=", mimeType: "image/png" };

  harness.input({ text: "检查这张图", images: [image], source: "interactive", streamingBehavior: "steer" });
  assert.deepEqual(harness.sent[0]?.content, [{ type: "text", text: "检查这张图" }, image]);
});

test("slash commands and empty submissions retain native handling", () => {
  const harness = createHarness();
  for (const text of ["/goal status", "  /help", "   "]) {
    assert.equal(
      harness.input({ text, source: "interactive", streamingBehavior: "steer" }),
      undefined,
    );
  }
  assert.equal(harness.sent.length, 0);
});

test("idle, non-TUI, non-interactive, and existing follow-up input are untouched", () => {
  const harness = createHarness();
  const ordinary = { text: "保留原样", source: "interactive" };
  assert.equal(harness.input(ordinary), undefined);
  assert.equal(harness.input({ ...ordinary, streamingBehavior: "followUp" }), undefined);
  assert.equal(harness.input({ ...ordinary, streamingBehavior: "steer", source: "rpc" }), undefined);
  assert.equal(harness.input({ ...ordinary, streamingBehavior: "steer" }, "rpc"), undefined);
  assert.equal(harness.sent.length, 0);
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
