/**
 * Runtime checks for the Codex-style /init command.
 *
 * Run with: node --experimental-strip-types tests/init-command.test.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JITI_PATH = "C:/Users/Administrator/.pi/agent/install/releases/1.4.0/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(JITI_PATH);

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { INIT_PROMPT, registerInitCommand } = await jiti.import("../internal/init-feature.ts");

function createHarness(idle = true) {
  const commands = new Map<string, any>();
  const sent: Array<{ content: string; options: any }> = [];
  const notices: Array<{ message: string; type?: string }> = [];
  const pi = {
    registerCommand(name: string, options: any) {
      commands.set(name, options);
    },
    sendUserMessage(content: string, options: any) {
      sent.push({ content, options });
    },
  };
  const ctx = {
    isIdle: () => idle,
    ui: {
      notify: (message: string, type?: string) => notices.push({ message, type }),
    },
  };

  registerInitCommand(pi as any);
  return { commands, sent, notices, ctx };
}

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

test("/init submits the Codex repository-guide prompt", async () => {
  const harness = createHarness();
  const command = harness.commands.get("init");

  assert.equal(command.description, "create an AGENTS.md file with instructions for Pi");
  await command.handler("", harness.ctx);

  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0]?.content, INIT_PROMPT);
  assert.deepEqual(harness.sent[0]?.options, { expandPromptTemplates: false });
  assert.match(INIT_PROMPT, /Before writing, check whether AGENTS\.md already exists/u);
  assert.match(INIT_PROMPT, /do not overwrite or modify it/u);
  assert.match(INIT_PROMPT, /200-400 words/u);
});

test("/init queues behind an active run", async () => {
  const harness = createHarness(false);
  await harness.commands.get("init").handler("", harness.ctx);

  assert.equal(harness.sent.length, 1);
  assert.deepEqual(harness.sent[0]?.options, {
    expandPromptTemplates: false,
    deliverAs: "followUp",
  });
});

test("/init rejects arguments", async () => {
  const harness = createHarness();
  await harness.commands.get("init").handler("custom instructions", harness.ctx);

  assert.equal(harness.sent.length, 0);
  assert.deepEqual(harness.notices, [{ message: "Usage: /init", type: "warning" }]);
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
