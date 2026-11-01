import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Route ordinary TUI messages submitted during a run to Pi's native follow-up queue. */
export function registerBackgroundTaskQueue(pi: ExtensionAPI): void {
  pi.on("input", (event, ctx) => {
    if (
      ctx.mode !== "tui" ||
      event.source !== "interactive" ||
      event.streamingBehavior !== "steer" ||
      event.text.trimStart().startsWith("/") ||
      (!event.text.trim() && !event.images?.length)
    ) {
      return;
    }

    const content = event.images?.length
      ? [{ type: "text" as const, text: event.text }, ...event.images]
      : event.text;
    pi.sendUserMessage(content, { deliverAs: "followUp", expandPromptTemplates: true });
    return { action: "handled" };
  });
}

export default registerBackgroundTaskQueue;
