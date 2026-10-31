import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const ENTRY_TYPE = "codex-style-todo-plan";
const STATUS_KEY = "codex-style-todo-plan";
const PLAN_SECTION = "codex_style_todo_plan";
const MAX_PLAN_ITEMS = 20;
const MAX_STEP_LENGTH = 500;

type TodoStatus = "pending" | "in_progress" | "completed";
type PlanItem = { step: string; status: TodoStatus };
type PlanDetails = { plan: PlanItem[] | null; explanation?: string; error?: string };

const statuses = new Set<TodoStatus>(["pending", "in_progress", "completed"]);
const UpdatePlanParams = Type.Object({
  explanation: Type.Optional(Type.String({ maxLength: 1000, description: "Briefly explain why the plan changed." })),
  plan: Type.Array(Type.Object({
    step: Type.String({ minLength: 1, maxLength: MAX_STEP_LENGTH, description: "A concise, actionable task." }),
    status: StringEnum(["pending", "in_progress", "completed"] as const),
  }), { minItems: 1, maxItems: MAX_PLAN_ITEMS, description: "The complete ordered plan, replacing the previous version." }),
});

function isPlanItem(value: unknown): value is PlanItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PlanItem>;
  return typeof item.step === "string" && item.step.trim().length > 0 && item.step.length <= MAX_STEP_LENGTH
    && statuses.has(item.status as TodoStatus);
}

function isPlan(value: unknown): value is PlanItem[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_PLAN_ITEMS && value.every(isPlanItem)
    && value.filter((item) => item.status === "in_progress").length <= 1;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}

function buildPlanPrompt(plan: PlanItem[]): string {
  const steps = plan.map((item) => `<step status="${item.status}">${escapeXml(item.step)}</step>`).join("\n");
  return [
    "<task_plan>",
    "Keep this checklist synchronized with the work. Use update_plan with the complete ordered list whenever a step changes.",
    "Keep at most one step in_progress; mark finished steps completed and do not claim completion before verifying the result.",
    steps,
    "</task_plan>",
  ].join("\n");
}
function formatPlan(plan: PlanItem[]): string {
  const done = plan.filter((item) => item.status === "completed").length;
  const lines = plan.map((item, index) => {
    const marker = item.status === "completed" ? "[x]" : item.status === "in_progress" ? "[>]" : "[ ]";
    return `${marker} ${index + 1}. ${item.step}`;
  });
  return `Plan (${done}/${plan.length} completed)\n${lines.join("\n")}`;
}

function statusText(plan: PlanItem[], theme: Theme): string {
  const completed = plan.filter((item) => item.status === "completed").length;
  const current = plan.find((item) => item.status === "in_progress");
  if (!current) {
    const summary = completed === plan.length ? "complete" : "pending";
    return theme.fg(completed === plan.length ? "success" : "muted", `☷ Plan ${completed}/${plan.length} · ${summary}`);
  }
  const summary = Array.from(current.step).slice(0, 42).join("");
  return theme.fg("accent", `☷ Plan ${completed}/${plan.length} · ${summary}${Array.from(current.step).length > 42 ? "…" : ""}`);
}

function renderStatus(plan: PlanItem[] | null, ctx: ExtensionContext): void {
  if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
  ctx.ui.setStatus(STATUS_KEY, plan ? statusText(plan, ctx.ui.theme) : undefined);
}

function normalizePlan(input: PlanItem[]): PlanItem[] {
  if (input.length === 0 || input.length > MAX_PLAN_ITEMS) {
    throw new Error(`A plan must contain 1-${MAX_PLAN_ITEMS} steps.`);
  }
  const plan = input.map(({ step, status }) => ({ step: step.trim(), status }));
  if (plan.some((item) => item.step.length === 0 || item.step.length > MAX_STEP_LENGTH)) {
    throw new Error(`Each step must contain 1-${MAX_STEP_LENGTH} non-whitespace characters.`);
  }
  if (plan.filter((item) => item.status === "in_progress").length > 1) {
    throw new Error("A plan can have at most one in-progress step.");
  }
  return plan;
}

export function registerCodexTodo(pi: ExtensionAPI): void {
  let plan: PlanItem[] | null = null;

  const restore = (ctx: ExtensionContext): void => {
    plan = null;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
      const data = entry.data as { version?: unknown; plan?: unknown } | undefined;
      if (data?.version === 1 && (data.plan === null || isPlan(data.plan))) {
        plan = data.plan === null ? null : data.plan.map((item) => ({ ...item }));
      }
    }
    renderStatus(plan, ctx);
  };

  const persist = (next: PlanItem[] | null): void => {
    plan = next;
    pi.appendEntry(ENTRY_TYPE, { version: 1, plan: next });
  };

  const planResult = (text: string, details: PlanDetails, isError = false) => ({
    content: [{ type: "text" as const, text }],
    details,
    isError,
  });

  pi.on("session_start", async (_event, ctx) => restore(ctx));
  pi.on("session_tree", async (_event, ctx) => restore(ctx));
  pi.on("before_agent_start", (event) => {
    if (plan) event.systemPromptOptions.sections[PLAN_SECTION] = buildPlanPrompt(plan);
    else delete event.systemPromptOptions.sections[PLAN_SECTION];
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.mode === "tui" || ctx.mode === "rpc") ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.registerTool({
    name: "update_plan",
    label: "Update plan",
    description: "Create or update the current task checklist for complex, multi-step work. Replace the full ordered plan each time. Use one in_progress step for the task currently being worked on; mark finished steps completed. Do not use for simple tasks or persistent long-term goals.",
    parameters: UpdatePlanParams,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        const next = normalizePlan(params.plan);
        persist(next);
        renderStatus(plan, ctx);
        const explanation = params.explanation?.trim();
        const text = `${explanation ? `${explanation}\n\n` : ""}${formatPlan(next)}`;
        return planResult(text, { plan: next.map((item) => ({ ...item })), ...(explanation ? { explanation } : {}) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return planResult(message, { plan: plan?.map((item) => ({ ...item })) ?? null, error: message }, true);
      }
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("update_plan ")) + theme.fg("muted", `${args.plan?.length ?? 0} steps`), 0, 0);
    },
    renderResult(result, _options, theme) {
      const details = result.details as PlanDetails | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      if (details.error) return new Text(theme.fg("error", details.error), 0, 0);
      if (!details.plan) return new Text(theme.fg("muted", "Plan cleared"), 0, 0);
      const lines = [theme.fg("muted", `${details.plan.filter((item) => item.status === "completed").length}/${details.plan.length} completed`)];
      for (const [index, item] of details.plan.entries()) {
        const marker = item.status === "completed" ? theme.fg("success", "✓")
          : item.status === "in_progress" ? theme.fg("accent", "▶") : theme.fg("dim", "○");
        const label = item.status === "completed" ? theme.fg("dim", item.step) : theme.fg("text", item.step);
        lines.push(`${marker} ${index + 1}. ${label}`);
      }
      return new Text(lines.join("\n"), 0, 0);
    },
  });

  const showPlan = (ctx: ExtensionContext): void => {
    ctx.ui.notify(plan ? formatPlan(plan) : "No task plan. The agent creates one for complex, multi-step work.", "info");
  };

  const handleCommand = async (args: string, ctx: ExtensionContext): Promise<void> => {
    const input = args.trim().toLowerCase();
    if (!input || input === "show" || input === "status") {
      showPlan(ctx);
      return;
    }
    if (input === "clear") {
      persist(null);
      renderStatus(plan, ctx);
      ctx.ui.notify("Task plan cleared.", "info");
      return;
    }
    ctx.ui.notify("Usage: /plan [show|clear]", "warning");
  };

  const completions = (prefix: string) => {
    const normalized = prefix.trim().toLowerCase();
    if (!normalized) return ["show", "clear"].map((value) => ({ value, label: value }));
    return ["show", "clear"].filter((value) => value.startsWith(normalized)).map((value) => ({ value, label: value }));
  };

  for (const commandName of ["plan", "todo", "todos"]) {
    pi.registerCommand(commandName, {
      description: commandName === "plan" ? "Show or clear the current task plan" : "Show the current task checklist",
      getArgumentCompletions: completions,
      handler: handleCommand,
    });
  }
}

export default registerCodexTodo;
