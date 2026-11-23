import assert from "node:assert/strict";
import test from "node:test";
import { registerStrictTabQueue } from "../omp/strict-tab-queue.ts";

type Handler = (event: { willContinue?: boolean; awaitingAsyncWork?: boolean }, context: unknown) => void;
type InputHandler = (key: string) => { consume?: boolean } | undefined;

function harness(mode = "tui", kind = "main") {
  const handlers = new Map<string, Handler>();
  const sent: string[] = [];
  const finishSend: Array<() => void> = [];
  let idle = true;
  let pending = false;
  let editor = "";
  let input: InputHandler | undefined;
  let widget: string[] | undefined;
  const ctx = {
    mode,
    agent: { kind },
    isIdle: () => idle,
    hasPendingMessages: () => pending,
    ui: {
      setWidget: (_key: string, content?: string[]) => { widget = content; },
      setEditorText: (text: string) => { editor = text; },
      getEditorText: () => editor,
      onTerminalInput(handler: InputHandler) {
        input = handler;
        return () => { input = undefined; };
      },
    },
  };
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    sendUserMessage(text: string) {
      sent.push(text);
      return new Promise<void>((resolve) => finishSend.push(resolve));
    },
  };
  registerStrictTabQueue(pi as unknown as Parameters<typeof registerStrictTabQueue>[0]);
  const emit = (name: string, event = {}) => handlers.get(name)?.(event, ctx);
  emit("session_start");
  return {
    sent,
    editor: () => editor,
    widget: () => widget,
    press(key: string, text: string) { editor = text; return input?.(key); },
    start() { idle = false; emit("agent_start"); },
    end(event = {}) { idle = true; emit("agent_end", event); },
    pending(value: boolean) { pending = value; },
    async acknowledge() { finishSend.shift()?.(); await Promise.resolve(); },
    emit,
  };
}

test("OMP Tab dispatches immediately when idle and leaves Enter, blank input and slash commands alone", async () => {
  const h = harness();
  assert.equal(h.press("\r", "enter"), undefined);
  assert.equal(h.press("\t", "  /help"), undefined);
  assert.equal(h.editor(), "  /help");
  assert.equal(h.press("\t", "  "), undefined);
  assert.deepEqual(h.press("\t", "first"), { consume: true });
  assert.equal(h.editor(), "");
  assert.deepEqual(h.press("\t", "second"), { consume: true });
  assert.deepEqual(h.sent, ["first"], "the next send must wait for admission and settle");
  h.start();
  await h.acknowledge();
  assert.deepEqual(h.sent, ["first"]);
  h.end();
  assert.deepEqual(h.sent, ["first", "second"]);
  await h.acknowledge();
});

test("OMP releases one message per terminal settle, with no release during retries, background waits or native queued input", async () => {
  const h = harness();
  h.start();
  for (const text of ["first", "second", "third"]) h.press("\t", text);
  h.emit("tool_execution_end");
  h.end({ willContinue: true });
  h.end({ awaitingAsyncWork: true });
  assert.deepEqual(h.sent, []);
  assert.equal(h.widget()?.length, 4);
  h.pending(true);
  h.end();
  assert.deepEqual(h.sent, []);
  h.pending(false);
  for (const expected of [["first"], ["first", "second"], ["first", "second", "third"]]) {
    h.start();
    h.end();
    assert.deepEqual(h.sent, expected);
    h.start();
    await h.acknowledge();
    assert.deepEqual(h.sent, expected);
  }
  h.end();
  assert.equal(h.widget(), undefined);
});

test("OMP queue resets on session switch and is disabled outside the main TUI", () => {
  const h = harness();
  h.start();
  h.press("\t", "old session");
  h.emit("session_switch");
  h.end();
  assert.deepEqual(h.sent, []);
  h.emit("session_shutdown");
  assert.equal(h.press("\t", "too late"), undefined);
  assert.equal(harness("rpc").press("\t", "headless"), undefined);
  assert.equal(harness("tui", "sub").press("\t", "subagent"), undefined);
});
