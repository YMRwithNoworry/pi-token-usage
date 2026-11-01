/** Runtime checks for subagent delegation and bounded teammate workflows. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JITI_PATH = "C:/Users/Administrator/.pi/agent/install/releases/1.4.0/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(JITI_PATH);
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { registerSubagentTeam } = await jiti.import("../internal/subagent-team-feature.ts");

type RpcRequest = { version: number; requestId: string; method: string; params: Record<string, unknown> };
type Handler = (data: unknown) => void;

function createHarness(hasSubagent = true) {
  const tools = new Map<string, any>();
  const listeners = new Map<string, Set<Handler>>();
  const requests: RpcRequest[] = [];
  const events = {
    on(name: string, handler: Handler) {
      const current = listeners.get(name) ?? new Set<Handler>();
      current.add(handler);
      listeners.set(name, current);
      return () => current.delete(handler);
    },
    emit(name: string, data: unknown) {
      for (const handler of listeners.get(name) ?? []) handler(data);
    },
  };
  const pi = {
    on() {},
    registerTool(tool: any) { tools.set(tool.name, tool); },
    events,
  };
  registerSubagentTeam(pi as any);
  events.on("subagents:rpc:v1:request", (raw) => {
    const request = raw as RpcRequest;
    requests.push(request);
    queueMicrotask(() => events.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
      version: 1,
      requestId: request.requestId,
      method: request.method,
      success: true,
      data: { text: "Subagent run started.", details: { runId: `run-${requests.length}`, state: "running" } },
    }));
  });
  events.emit("subagents:rpc:v1:ready", {});
  const ctx = { tools: hasSubagent ? [{ name: "subagent" }] : [] };
  return { tools, requests, events, ctx };
}

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

const teamInput = {
  task: "Inspect the extension architecture",
  members: [
    { agent: "scout", focus: "Map relevant modules and entry points" },
    { agent: "reviewer", focus: "Identify correctness and test risks" },
  ],
};

test("registers delegate and team tools", () => {
  const harness = createHarness();
  assert.equal(harness.tools.has("delegate"), true);
  assert.equal(harness.tools.has("team"), true);
});

test("delegate routes one task through the public subagent RPC", async () => {
  const harness = createHarness();
  const result = await harness.tools.get("delegate").execute("call-1", {
    agent: "scout",
    task: "Map the extension entry points",
  }, undefined, undefined, harness.ctx);

  assert.equal(result.isError, false);
  assert.match(result.content[0].text, /run-1/u);
  assert.deepEqual(harness.requests[0], {
    version: 1,
    requestId: harness.requests[0].requestId,
    method: "spawn",
    params: { agent: "scout", task: "Map the extension entry points" },
  });
});

test("rejects calls when pi-subagents is unavailable or not present in tool context", async () => {
  const harness = createHarness(false);
  const result = await harness.tools.get("delegate").execute("call-1", { agent: "scout", task: "Map modules" }, undefined, undefined, harness.ctx);

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Install and enable pi-subagents/u);
  assert.equal(harness.requests.length, 0);
});

test("team launches a timed workflow and relays an early member's findings", async () => {
  const harness = createHarness();
  const result = await harness.tools.get("team").execute("call-1", teamInput, undefined, undefined, harness.ctx);
  const request = harness.requests[0];

  assert.equal(result.isError, false);
  assert.equal(result.details.teamSize, 2);
  assert.equal(request.method, "spawn");
  assert.equal(request.params.options && (request.params.options as any).timeoutMs, 900_000);
  const script = String(request.params.script);
  assert.match(script, /Promise\.race/u);
  assert.match(script, /runs\.steer/u);
  assert.match(script, /Inspect the extension architecture/u);

  const steers: Array<{ key: string; message: string; options: unknown }> = [];
  const runs = {
    run: ({ agent }: { key: string; agent: string; task: string }) => Promise.resolve({ ok: true, output: `${agent} discovery` }),
    steer: (key: string, message: string, options: unknown) => {
      steers.push({ key, message, options });
      return Promise.resolve({ deliveryStatus: "queued" });
    },
  };
  const executeScript = new Function("runs", `return (async () => {\n${script}\n})()`);
  const workflowResult = await executeScript(runs);

  assert.equal(workflowResult.length, 2);
  assert.equal(steers.length, 1);
  assert.equal(steers[0].key, "member-2");
  assert.match(steers[0].message, /scout discovery/u);
  assert.deepEqual(steers[0].options, { mode: "follow_up" });
});

test("rejects team sizes outside the two-to-four member bound", async () => {
  const harness = createHarness();
  const tooSmall = await harness.tools.get("team").execute("call-1", { ...teamInput, members: [teamInput.members[0]] }, undefined, undefined, harness.ctx);
  const tooLarge = await harness.tools.get("team").execute("call-2", { ...teamInput, members: [...teamInput.members, ...teamInput.members, ...teamInput.members] }, undefined, undefined, harness.ctx);

  assert.equal(tooSmall.isError, true);
  assert.equal(tooLarge.isError, true);
  assert.equal(harness.requests.length, 0);
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
