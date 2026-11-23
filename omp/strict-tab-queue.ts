import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const KEY = "codex-style-strict-tab";

export function registerStrictTabQueue(pi: ExtensionAPI): void {
  let context: ExtensionContext | undefined;
  let unsubscribe: (() => void) | undefined;
  let queue: string[] = [];
  let runActive = false;
  let sending = false;

  function render(ctx: ExtensionContext): void {
    ctx.ui.setWidget(KEY, queue.length ? [
      `严格队列：${queue.length} 条待发送`,
      ...queue.slice(0, 5).map((text, index) => `${index + 1}. ${text.replace(/\s+/gu, " ").trim().slice(0, 64)}`),
      ...(queue.length > 5 ? ["…"] : []),
    ] : undefined);
  }

  function sendNext(): void {
    const ctx = context;
    if (!ctx || sending || runActive || !ctx.isIdle() || ctx.hasPendingMessages() || !queue.length) return;
    const currentQueue = queue;
    const text = currentQueue.shift()!;
    sending = true;
    render(ctx);
    void pi.sendUserMessage(text).then(() => {
      if (queue !== currentQueue) return;
      sending = false;
      sendNext();
    }, (error: unknown) => {
      if (queue !== currentQueue) return;
      sending = false;
      currentQueue.unshift(text);
      render(ctx);
      ctx.ui.notify(`严格队列发送失败：${error instanceof Error ? error.message : String(error)}`, "error");
    });
  }

  function detach(): void {
    unsubscribe?.();
    unsubscribe = undefined;
    context?.ui.setWidget(KEY, undefined);
    context = undefined;
    queue = [];
    runActive = false;
    sending = false;
  }

  function attach(ctx: ExtensionContext): void {
    detach();
    if (ctx.mode !== "tui" || ctx.agent.kind === "sub") return;
    context = ctx;
    runActive = !ctx.isIdle();
    unsubscribe = ctx.ui.onTerminalInput((key) => {
      if (key !== "\t") return;
      const text = ctx.ui.getEditorText();
      if (!text.trim() || text.trimStart().startsWith("/")) return;
      queue.push(text);
      ctx.ui.setEditorText("");
      render(ctx);
      sendNext();
      return { consume: true };
    });
  }

  pi.on("session_start", (_event, ctx) => attach(ctx));
  pi.on("session_switch", (_event, ctx) => attach(ctx));
  pi.on("session_clear", (_event, ctx) => attach(ctx));
  pi.on("session_shutdown", () => detach());
  pi.on("agent_start", () => {
    if (context) runActive = true;
  });
  // OMP also emits agent_end when a model loop pauses inside a still-open run.
  pi.on("agent_end", (event) => {
    if (!context || event.willContinue || event.awaitingAsyncWork) return;
    runActive = false;
    sendNext();
  });
}
