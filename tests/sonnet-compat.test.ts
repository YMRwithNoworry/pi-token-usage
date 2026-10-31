/**
 * Runtime checks for Claude 5.5 Anthropic payload compatibility.
 *
 * Run with: node --experimental-strip-types tests/sonnet-compat.test.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JITI_PATH = "C:/Users/Administrator/.pi/agent/install/releases/1.4.0/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(JITI_PATH);

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { normalizeSonnet55Payload, registerSonnetCompatibility } = await jiti.import("../internal/sonnet-compat-feature.ts");

type Handler = (event: any, ctx: any) => unknown;

const sonnetModel = {
  id: "claude-sonnet-5-5",
  api: "anthropic-messages",
  provider: "third-party",
};

const blccOpusModel = {
  id: "claude-opus-5-5",
  api: "anthropic-messages",
  provider: "blcc",
};

function createHarness(model: any = sonnetModel, includeEarlierHandler = false) {
  const handlers: Handler[] = [];
  const pi = {
    on(event: string, handler: Handler) {
      if (event === "before_provider_request") handlers.push(handler);
      return () => {};
    },
  };
  if (includeEarlierHandler) {
    pi.on("before_provider_request", async (event) => ({
      ...(event.payload as Record<string, unknown>),
      earlierHandlerRan: true,
    }));
  }
  registerSonnetCompatibility(pi as any);
  const ctx = { model };
  return {
    async transform(payload: unknown): Promise<unknown> {
      let current = payload;
      for (const handler of handlers) {
        const result = await handler({ type: "before_provider_request", payload: current }, ctx);
        if (result !== undefined) current = result;
      }
      return current;
    },
  };
}

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

test("converts legacy enabled thinking to adaptive thinking", async () => {
  const payload = {
    model: "claude-sonnet-5-5",
    max_tokens: 4096,
    thinking: {
      type: "enabled",
      budget_tokens: 2048,
      display: "summarized",
    },
  };
  const result = normalizeSonnet55Payload(payload, sonnetModel) as any;

  assert.deepEqual(result.thinking, { type: "adaptive", display: "summarized" });
  assert.equal(result.max_tokens, 4096);
  assert.equal((payload.thinking as any).type, "enabled");
});

test("converts legacy enabled thinking for BLCC Opus 5.5", async () => {
  const payload = {
    model: "claude-opus-5-5",
    thinking: {
      type: "enabled",
      budget_tokens: 4096,
    },
  };
  const result = normalizeSonnet55Payload(payload, blccOpusModel) as any;

  assert.deepEqual(result.thinking, { type: "adaptive" });
  assert.equal((payload.thinking as any).type, "enabled");
});

test("preserves block binding while converting enabled thinking", async () => {
  const payload = {
    thinking: {
      type: "enabled",
      budget_tokens: 4096,
      block_binding: { prefix_mismatch_behavior: "drop_block" },
    },
  };
  const result = normalizeSonnet55Payload(payload, sonnetModel) as any;
  assert.deepEqual(result.thinking, {
    type: "adaptive",
    block_binding: { prefix_mismatch_behavior: "drop_block" },
  });
});

test("limits Opus 5.5 compatibility to the BLCC provider", async () => {
  const payload = { thinking: { type: "enabled", budget_tokens: 2048 } };
  const cases = [
    { id: "claude-opus-5-5", api: "anthropic-messages", provider: "other-provider" },
    { id: "claude-opus-5-5", api: "openai-completions", provider: "blcc" },
  ];
  for (const model of cases) assert.strictEqual(normalizeSonnet55Payload(payload, model), payload);
});

test("omits disabled thinking for Sonnet 5.5", async () => {
  const payload = { model: "claude-sonnet-5-5", thinking: { type: "disabled" }, temperature: 1 };
  const result = normalizeSonnet55Payload(payload, sonnetModel) as any;
  assert.equal("thinking" in result, false);
  assert.equal(result.temperature, 1);
});

test("preserves adaptive, between_tools, and absent thinking", async () => {
  for (const thinking of [
    { type: "adaptive", display: "omitted" },
    { type: "between_tools" },
    undefined,
  ]) {
    const payload = thinking === undefined ? { messages: [] } : { thinking };
    const result = normalizeSonnet55Payload(payload, sonnetModel);
    assert.deepEqual(result, payload);
  }
});

test("changes a third-party Anthropic Messages Sonnet entry", async () => {
  const payload = { thinking: { type: "enabled", budget_tokens: 2048 } };
  const result = normalizeSonnet55Payload(payload, {
    id: "claude-sonnet-5-5",
    api: "anthropic-messages",
    provider: "custom-provider",
  }) as any;
  assert.deepEqual(result.thinking, { type: "adaptive" });
});

test("does not change other models or APIs", async () => {
  const payload = { thinking: { type: "enabled", budget_tokens: 2048 } };
  const cases = [
    { id: "claude-opus-5-5", api: "anthropic-messages", provider: "other-provider" },
    { id: "claude-opus-5-5", api: "openai-completions", provider: "blcc" },
    { id: "claude-sonnet-5-4", api: "anthropic-messages" },
    { id: "claude-sonnet-5-5", api: "openai-completions" },
    { id: "claude-sonnet-5-5", api: "bedrock-converse-stream" },
    undefined,
  ];
  for (const model of cases) assert.strictEqual(normalizeSonnet55Payload(payload, model), payload);
});

test("composes with earlier before_provider_request handlers", async () => {
  const harness = createHarness(sonnetModel, true);
  const transformed = await harness.transform({ thinking: { type: "enabled", budget_tokens: 1024 } });
  assert.equal((transformed as any).earlierHandlerRan, true);
  assert.deepEqual((transformed as any).thinking, { type: "adaptive" });
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
