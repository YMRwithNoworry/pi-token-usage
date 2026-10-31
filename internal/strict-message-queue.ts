import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { ImageContent } from "@earendil-works/pi-ai";

const QUEUE_WIDGET_KEY = "strict-message-queue";
const EDIT_BUTTON = "[编辑]";
const DELETE_BUTTON = "[删除]";
const BUTTONS = `${EDIT_BUTTON} ${DELETE_BUTTON}`;
const HEADER = "严格队列";
const MAX_PREVIEW_WIDTH = 80;

type QueuedMessage = {
  id: number;
  text: string;
  images?: ImageContent[];
};

function isCommand(text: string): boolean {
  return text.trimStart().startsWith("/");
}

function flatten(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** Right-aligned button hit test for one rendered queue row. */
function buttonAt(column: number, width: number): "edit" | "delete" | undefined {
  const start = width - visibleWidth(BUTTONS);
  if (column < start) return undefined;
  const editWidth = visibleWidth(EDIT_BUTTON);
  return column < start + editWidth ? "edit" : "delete";
}

class QueueWidget implements Component {
  constructor(
    private readonly getQueue: () => QueuedMessage[],
    private readonly getTheme: () => ExtensionContext["ui"]["theme"],
    private readonly onEdit: (id: number) => void,
    private readonly onDelete: (id: number) => void,
  ) {}

  render(width: number): string[] {
    const queue = this.getQueue();
    if (queue.length === 0) return [];
    const theme = this.getTheme();
    const textWidth = Math.min(MAX_PREVIEW_WIDTH, Math.max(12, width - visibleWidth(BUTTONS) - 5));

    const lines = [
      truncateToWidth(
        `${theme.fg("accent", `⏳ ${HEADER}`)} ${theme.fg("muted", `${queue.length} 条待发送`)}`,
        width,
      ),
    ];

    for (const [index, item] of queue.entries()) {
      const prefix = theme.fg("dim", `${index + 1}. `);
      const label = prefix + theme.fg("text", truncateToWidth(flatten(item.text), textWidth, "…"));
      const buttons =
        theme.fg("accent", EDIT_BUTTON) + " " + theme.fg("error", DELETE_BUTTON);
      const pad = Math.max(1, width - visibleWidth(label) - visibleWidth(BUTTONS));
      lines.push(truncateToWidth(label + " ".repeat(pad) + buttons, width));
    }

    lines.push(truncateToWidth(theme.fg("dim", "Tab 入队 · Esc 停止后仍按顺序发送"), width));
    return lines;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "click" || event.button !== "left") return undefined;
    const queue = this.getQueue();
    const row = event.y - 1;
    if (row < 0 || row >= queue.length) return undefined;
    const target = buttonAt(event.x, event.width);
    if (!target) return undefined;
    const item = queue[row];
    if (!item) return undefined;
    if (target === "edit") this.onEdit(item.id);
    else this.onDelete(item.id);
    return { handled: true, render: true };
  }

  invalidate(): void {}
}

/** Strict Tab queue: each message waits until the previous run has fully settled. */
export function registerStrictMessageQueue(pi: ExtensionAPI): void {
  let queue: QueuedMessage[] = [];
  let nextId = 1;
  let activeContext: ExtensionContext | undefined;
  let sending = false;
  let unsubscribeInput: (() => void) | undefined;

  const renderQueue = (ctx: ExtensionContext | undefined): void => {
    if (!ctx || ctx.mode !== "tui") return;
    if (queue.length === 0) {
      ctx.ui.setWidget(QUEUE_WIDGET_KEY, undefined);
      return;
    }
    ctx.ui.setWidget(
      QUEUE_WIDGET_KEY,
      (tui, theme) =>
        new QueueWidget(
          () => queue,
          () => theme,
          (id) => void editItem(id),
          (id) => {
            queue = queue.filter((item) => item.id !== id);
            renderQueue(activeContext);
            tui.requestRender();
          },
        ),
      { placement: "belowEditor" },
    );
  };

  const sendNext = (): void => {
    const ctx = activeContext;
    if (sending || !ctx || !ctx.isIdle() || queue.length === 0) return;
    const item = queue.shift();
    if (!item) return;
    sending = true;
    renderQueue(ctx);
    pi.sendUserMessage(
      item.images && item.images.length > 0
        ? [{ type: "text", text: item.text }, ...item.images]
        : item.text,
    );
  };

  async function editItem(id: number): Promise<void> {
    const ctx = activeContext;
    if (!ctx || ctx.mode !== "tui") return;
    const item = queue.find((candidate) => candidate.id === id);
    if (!item) return;
    const edited = await ctx.ui.editor("编辑排队消息", item.text);
    if (edited === undefined) return;
    const replacement = edited.trim();
    if (!replacement) return;
    item.text = replacement;
    renderQueue(ctx);
  }

  const chooseQueueItem = async (action: "edit" | "delete", ctx: ExtensionContext): Promise<void> => {
    if (queue.length === 0) {
      ctx.ui.notify("严格队列为空", "info");
      return;
    }
    const labels = queue.map((item, index) => `${index + 1}. ${truncateToWidth(flatten(item.text), 60, "…")}`);
    const choice = await ctx.ui.select(`严格队列（${queue.length} 条）· ${action === "edit" ? "编辑" : "删除"}`, labels);
    if (choice === undefined) return;
    const index = labels.indexOf(choice);
    const item = queue[index];
    if (!item) return;
    if (action === "edit") {
      await editItem(item.id);
    } else {
      queue = queue.filter((candidate) => candidate.id !== item.id);
      renderQueue(ctx);
      ctx.ui.notify("已从严格队列删除", "info");
    }
  };

  pi.registerCommand("queue", {
    description: "查看严格队列；/queue edit 编辑，/queue delete 删除，/queue clear 清空",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action === "edit") return chooseQueueItem("edit", ctx);
      if (action === "delete" || action === "remove") return chooseQueueItem("delete", ctx);
      if (action === "clear") {
        const count = queue.length;
        queue = [];
        renderQueue(ctx);
        ctx.ui.notify(`已清空严格队列（${count} 条）`, "info");
        return;
      }
      if (queue.length === 0) {
        ctx.ui.notify("严格队列为空；输入消息后按 Tab 入队", "info");
        return;
      }
      ctx.ui.notify(queue.map((item, index) => `${index + 1}. ${flatten(item.text)}`).join("\n"), "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    activeContext = ctx;
    sending = false;
    queue = [];
    nextId = 1;
    unsubscribeInput?.();
    unsubscribeInput = undefined;
    renderQueue(ctx);
    if (ctx.mode !== "tui") return;

    unsubscribeInput = ctx.ui.onTerminalInput((data) => {
      if (data !== "\t") return undefined;
      const text = ctx.ui.getEditorText();
      // Empty editor and slash commands keep Pi's normal Tab completion.
      if (!text.trim() || isCommand(text)) return undefined;
      queue.push({ id: nextId++, text });
      ctx.ui.setEditorText("");
      renderQueue(ctx);
      // Nothing is running yet, so this message starts immediately.
      if (ctx.isIdle()) sendNext();
      return { consume: true };
    });
  });

  pi.on("agent_start", async (_event, ctx) => {
    activeContext = ctx;
    sending = false;
    renderQueue(ctx);
  });

  // Fires only once a run has fully settled: no retry, compaction, or continuation pending.
  pi.on("agent_settled", async (_event, ctx) => {
    activeContext = ctx;
    sending = false;
    renderQueue(ctx);
    sendNext();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    unsubscribeInput?.();
    unsubscribeInput = undefined;
    activeContext = undefined;
    sending = false;
    if (ctx.mode === "tui") ctx.ui.setWidget(QUEUE_WIDGET_KEY, undefined);
  });
}

export default registerStrictMessageQueue;
