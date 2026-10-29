import { registerPersistentGoals } from "./internal/goal-feature.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";

const STATUS_KEY = "token-usage";

type Totals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
};

const emptyTotals = (): Totals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
const numberOrZero = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;
const formatTokens = (value: number): string => Math.round(value).toLocaleString("en-US");
const formatCost = (value: number): string => value > 0 ? `$${value.toFixed(4)}` : "$0";

function addUsage(totals: Totals, usage: Usage | undefined): void {
  if (!usage) return;
  totals.input += numberOrZero(usage.input);
  totals.output += numberOrZero(usage.output);
  totals.cacheRead += numberOrZero(usage.cacheRead);
  totals.cacheWrite += numberOrZero(usage.cacheWrite);
  totals.cost += numberOrZero(usage.cost?.total);
}

function combinedTotals(total: Totals, turn: Totals): Totals {
  return {
    input: total.input + turn.input,
    output: total.output + turn.output,
    cacheRead: total.cacheRead + turn.cacheRead,
    cacheWrite: total.cacheWrite + turn.cacheWrite,
    cost: total.cost + turn.cost,
  };
}

/** Rough fallback for providers that report output usage only after a response completes. */
function estimateOutputTokens(message: AssistantMessage): number {
  let cjk = 0;
  let other = 0;
  for (const block of message.content) {
    let text = "";
    if (block.type === "text") text = block.text;
    else if (block.type === "thinking") text = block.thinking;
    else if (block.type === "toolCall") text = JSON.stringify(block.arguments) ?? "";

    for (const character of text) {
      if (/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/u.test(character)) cjk++;
      else other++;
    }
  }
  return cjk + Math.ceil(other / 4);
}

function usageText(
  totals: Totals,
  live: boolean,
  inputEstimated = false,
  inputUnknown = false,
  outputEstimated = false,
): string {
  const prefix = live ? "●" : "✓";
  const input = inputUnknown ? "?" : `${inputEstimated ? "~" : ""}${formatTokens(totals.input)}`;
  const output = `${outputEstimated ? "~" : ""}${formatTokens(totals.output)}`;
  const cache = totals.cacheRead || totals.cacheWrite
    ? ` · cache R${formatTokens(totals.cacheRead)}/W${formatTokens(totals.cacheWrite)}`
    : "";
  return `${prefix} ↑${input} ↓${output}${cache} · ${formatCost(totals.cost)}`;
}

export default function tokenUsage(pi: ExtensionAPI) {
  registerPersistentGoals(pi);
  let total = emptyTotals();
  let turn = emptyTotals();
  let streaming = false;
  let inputEstimated = false;
  let inputUnknown = false;
  let outputEstimated = false;
  let estimatedOutput = 0;

  const render = (ctx: ExtensionContext, live = streaming) => {
    if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
    const theme = ctx.ui.theme;
    const displayTurn = { ...turn };
    if (live && outputEstimated) displayTurn.output = estimatedOutput;
    const text = usageText(
      live ? combinedTotals(total, displayTurn) : total,
      live,
      live && inputEstimated,
      live && inputUnknown,
      live && outputEstimated,
    );
    ctx.ui.setStatus(STATUS_KEY, live ? theme.fg("accent", text) : theme.fg("dim", text));
  };

  pi.on("session_start", async (_event, ctx) => {
    total = emptyTotals();
    turn = emptyTotals();
    streaming = false;
    inputEstimated = false;
    inputUnknown = false;
    outputEstimated = false;
    estimatedOutput = 0;

    // Restore the visible totals from the active branch, including previous turns.
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "assistant") {
        addUsage(total, entry.message.usage);
      } else if (entry.type === "compaction" || entry.type === "branch_summary" || entry.type === "usage") {
        addUsage(total, entry.usage);
      }
    }
    render(ctx, false);
  });

  pi.on("turn_start", async (_event, ctx) => {
    turn = emptyTotals();
    streaming = true;
    inputEstimated = false;
    inputUnknown = true;
    outputEstimated = true;
    estimatedOutput = 0;
    render(ctx);
  });

  pi.on("message_update", async (event, ctx) => {
    const streamEvent = event.assistantMessageEvent;
    if (!("partial" in streamEvent)) return;

    const partial = streamEvent.partial;
    if (partial.role !== "assistant") return;

    turn = emptyTotals();
    addUsage(turn, partial.usage);

    if (partial.usage.input > 0) {
      inputEstimated = false;
      inputUnknown = false;
    } else {
      inputEstimated = true;
      const contextTokens = ctx.getContextUsage()?.tokens;
      inputUnknown = typeof contextTokens !== "number";
      turn.input = typeof contextTokens === "number" ? contextTokens : 0;
    }

    outputEstimated = !(partial.usage.output > 0);
    estimatedOutput = outputEstimated ? estimateOutputTokens(partial) : 0;
    render(ctx);
  });

  pi.on("turn_end", async (event, ctx) => {
    if (event.message.role === "assistant") addUsage(total, event.message.usage);
    streaming = false;
    turn = emptyTotals();
    inputEstimated = false;
    inputUnknown = false;
    outputEstimated = false;
    estimatedOutput = 0;
    render(ctx, false);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.mode === "tui" || ctx.mode === "rpc") ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
