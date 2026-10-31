import { randomUUID } from "node:crypto";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ENTRY_TYPE = "pi-persistent-goal";
const MAX_AUTO_CONTINUATIONS_PER_REQUEST = 8;
const GOAL_SECTION = "pi_persistent_goal";

type GoalStatus = "active" | "paused" | "complete" | "blocked" | "budget_limited";
type Goal = {
  id: string;
  objective: string;
  status: GoalStatus;
  createdAt: number;
  updatedAt: number;
  tokensUsed: number;
  tokenBudget?: number;
  turnCount: number;
  blockedReason?: string;
  blockedStreak: number;
  blockedLastTurn?: number;
};

const statuses = new Set<GoalStatus>(["active", "paused", "complete", "blocked", "budget_limited"]);
const CreateGoalParams = Type.Object({
  objective: Type.String({ minLength: 1, maxLength: 10000, description: "Concrete long-running objective explicitly requested by the user." }),
  token_budget: Type.Optional(Type.Integer({ minimum: 1, description: "Optional positive token budget, only if the user explicitly requests one." })),
});
const UpdateGoalParams = Type.Object({
  status: StringEnum(["complete", "blocked", "paused"] as const),
  reason: Type.Optional(Type.String({ maxLength: 1000, description: "Required for blocked: the recurring blocker." })),
});

function isGoal(value: unknown): value is Goal {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Goal>;
  return typeof item.id === "string"
    && typeof item.objective === "string"
    && statuses.has(item.status as GoalStatus)
    && typeof item.createdAt === "number"
    && typeof item.updatedAt === "number"
    && typeof item.tokensUsed === "number"
    && Number.isSafeInteger(item.turnCount)
    && typeof item.blockedStreak === "number"
    && (item.tokenBudget === undefined || (Number.isSafeInteger(item.tokenBudget) && item.tokenBudget > 0))
    && (item.blockedReason === undefined || typeof item.blockedReason === "string")
    && (item.blockedLastTurn === undefined || Number.isSafeInteger(item.blockedLastTurn));
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function userRequestedPause(prompt: string): boolean {
  const negative = /\b(?:do not|don't|don’t|never|without)\b.{0,30}\b(?:pause|suspend|halt|stop)\b|(?:不要|别|不必|不用|无需).{0,10}(?:暂停|停止|搁置)/iu;
  if (negative.test(prompt)) return false;
  return /\b(?:pause|suspend|halt|stop)\s+(?:the\s+)?(?:current\s+)?(?:goal|task|work)\b|(?:暂停|暂停当前(?:目标|任务)|先停下(?:当前)?(?:目标|任务)?)/iu.test(prompt);
}

function formatTokens(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function buildGoalPrompt(goal: Goal): string {
  const lines = [
    `<persistent_goal status="${goal.status}" tokens_used="${goal.tokensUsed}" token_budget="${goal.tokenBudget ?? "none"}">`,
    `<objective>${escapeXml(goal.objective)}</objective>`,
    "Keep the full objective intact across turns; inspect the current project state and make concrete progress toward it.",
    "Completion requires verifying the requested end state. If unfinished, keep the goal active. Difficulty or a temporary blocker alone is not completion.",
    "Only pause if the user explicitly asks. Only mark blocked when the same blocker genuinely persists across three consecutive model turns.",
    "Use get_goal to inspect the goal and update_goal to mark complete, blocked, or paused. The token budget is a limit, never a reason to claim completion.",
  ];
  if (goal.blockedStreak > 0 && goal.blockedReason) {
    lines.push(`<blocked_audit attempts="${goal.blockedStreak}/3">${escapeXml(goal.blockedReason)}</blocked_audit>`);
  }
  lines.push("</persistent_goal>");
  return lines.join("\n");
}

function goalDescription(goal: Goal): string {
  const budget = goal.tokenBudget === undefined ? "unlimited" : `${formatTokens(goal.tokenBudget)} tokens`;
  const remaining = goal.tokenBudget === undefined ? "unlimited" : `${formatTokens(Math.max(0, goal.tokenBudget - goal.tokensUsed))} tokens`;
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - goal.createdAt) / 1000));
  const elapsed = elapsedSeconds < 60
    ? `${elapsedSeconds}s`
    : elapsedSeconds < 3600
      ? `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`
      : `${Math.floor(elapsedSeconds / 3600)}h ${Math.floor((elapsedSeconds % 3600) / 60)}m`;
  return [
    `Goal: ${goal.objective}`,
    `Status: ${goal.status}`,
    `Usage: ${formatTokens(goal.tokensUsed)} tokens (${budget} budget; ${remaining} remaining)`,
    `Model turns: ${goal.turnCount}; elapsed: ${elapsed}`,
    ...(goal.blockedStreak > 0 ? [`Same-blocker audit: ${goal.blockedStreak}/3${goal.blockedReason ? ` — ${goal.blockedReason}` : ""}`] : []),
  ].join("\n");
}

function statusText(goal: Goal, theme: ExtensionContext["ui"]["theme"]): string {
  const icon = goal.status === "active" ? "🎯" : goal.status === "complete" ? "✓" : goal.status === "blocked" ? "⚠" : goal.status === "budget_limited" ? "⌛" : "Ⅱ";
  const color = goal.status === "active" ? "accent" : goal.status === "complete" ? "success" : goal.status === "blocked" || goal.status === "budget_limited" ? "warning" : "muted";
  const chars = Array.from(goal.objective);
  const summary = chars.slice(0, 34).join("") + (chars.length > 34 ? "…" : "");
  const budget = goal.tokenBudget === undefined ? "∞" : formatTokens(goal.tokenBudget);
  return theme.fg(color, `${icon} ${goal.status} ${formatTokens(goal.tokensUsed)}/${budget}t · ${summary}`);
}

function parseStartArgs(input: string): { objective: string; tokenBudget?: number } {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  const objective: string[] = [];
  let tokenBudget: number | undefined;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "--budget") {
      const value = Number(parts[++i]);
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("--budget must be followed by a positive integer.");
      tokenBudget = value;
    } else if (parts[i].startsWith("--budget=")) {
      const value = Number(parts[i].slice("--budget=".length));
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("--budget must be a positive integer.");
      tokenBudget = value;
    } else {
      objective.push(parts[i]);
    }
  }
  return { objective: objective.join(" ").trim(), ...(tokenBudget === undefined ? {} : { tokenBudget }) };
}

export function registerPersistentGoals(pi: ExtensionAPI): void {
  let goal: Goal | null = null;
  let lastUserPromptAllowsPause = false;
  let currentModelTurn = 0;
  let turnStartTimestamp = 0;
  let turnGoalId: string | null = null;
  let automaticContinuations = 0;
  let continuationLimitReached = false;

  const renderStatus = (ctx: ExtensionContext): void => {
    if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
    if (!goal) {
      ctx.ui.setStatus("persistent-goal", undefined);
      return;
    }
    const label = statusText(goal, ctx.ui.theme);
    const suffix = continuationLimitReached && goal.status === "active"
      ? ctx.ui.theme.fg("warning", " · auto-limit")
      : "";
    ctx.ui.setStatus("persistent-goal", label + suffix);
  };

  const persist = (next: Goal | null): void => {
    goal = next;
    pi.appendEntry(ENTRY_TYPE, { version: 1, goal: next });
  };

  const restore = (ctx: ExtensionContext): void => {
    goal = null;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
      const data = entry.data as { version?: unknown; goal?: unknown } | undefined;
      if (data?.version === 1 && (data.goal === null || isGoal(data.goal))) goal = data.goal as Goal | null;
    }
    automaticContinuations = 0;
    continuationLimitReached = false;
    renderStatus(ctx);
  };

  const save = (next: Goal): Goal => {
    persist(next);
    return next;
  };

  const start = (objective: string, tokenBudget?: number): Goal => {
    const trimmed = objective.trim();
    if (!trimmed || trimmed.length > 10000) throw new Error("Goal must contain 1–10,000 characters.");
    if (tokenBudget !== undefined && (!Number.isSafeInteger(tokenBudget) || tokenBudget < 1)) throw new Error("Token budget must be a positive integer.");
    if (goal && goal.status !== "complete") throw new Error(`An unfinished goal already exists (${goal.status}). Resume it, or clear it first.`);

    const now = Date.now();
    const next: Goal = {
      id: randomUUID(), objective: trimmed, status: "active", createdAt: now, updatedAt: now,
      tokensUsed: 0, turnCount: 0, blockedStreak: 0,
      ...(tokenBudget === undefined ? {} : { tokenBudget }),
    };
    automaticContinuations = 0;
    continuationLimitReached = false;
    return save(next);
  };

  const toolResult = (text: string, isError = false) => ({
    content: [{ type: "text" as const, text }],
    details: { goal: goal ? { ...goal } : null },
    isError,
  });

  pi.on("session_start", async (_event, ctx) => restore(ctx));
  pi.on("session_tree", async (_event, ctx) => restore(ctx));

  pi.on("before_agent_start", (event) => {
    if (event.messageType === "user") {
      lastUserPromptAllowsPause = userRequestedPause(event.prompt);
      automaticContinuations = 0;
      continuationLimitReached = false;
    }
    if (goal?.status === "active") event.systemPromptOptions.sections[GOAL_SECTION] = buildGoalPrompt(goal);
    else delete event.systemPromptOptions.sections[GOAL_SECTION];
  });

  pi.on("turn_start", async (event) => {
    turnStartTimestamp = event.timestamp;
    currentModelTurn = (goal?.turnCount ?? 0) + 1;
    turnGoalId = goal?.status === "active" ? goal.id : null;
  });

  pi.on("turn_end", async (event, ctx) => {
    const current = goal;
    const createdDuringTurn = current && turnStartTimestamp > 0 && current.createdAt >= turnStartTimestamp;
    if (!current || (turnGoalId !== current.id && !createdDuringTurn) || event.message.role !== "assistant") return;

    const usage = event.message.usage;
    const turnTokens = typeof usage.totalTokens === "number" && usage.totalTokens > 0
      ? usage.totalTokens
      : Math.max(0, (usage.input || 0) + (usage.output || 0));
    const updated: Goal = {
      ...current,
      turnCount: current.turnCount + 1,
      tokensUsed: current.tokensUsed + turnTokens,
      updatedAt: Date.now(),
    };
    if (updated.tokenBudget !== undefined && updated.tokensUsed >= updated.tokenBudget && updated.status === "active") {
      updated.status = "budget_limited";
    }
    turnGoalId = null;
    turnStartTimestamp = 0;
    save(updated);
    renderStatus(ctx);
    if (updated.status === "budget_limited" && ctx.hasUI) {
      ctx.ui.notify("Goal token budget reached. Increase or remove it with /goal budget before resuming.", "warning");
    }
  });

  pi.on("agent_before_settle", async (event, ctx) => {
    if (!goal || goal.status !== "active" || event.outcome !== "completed" || !event.context.canContinue || ctx.hasPendingMessages()) return;
    if (automaticContinuations >= MAX_AUTO_CONTINUATIONS_PER_REQUEST) {
      continuationLimitReached = true;
      renderStatus(ctx);
      if (ctx.hasUI) ctx.ui.notify("Automatic goal continuation limit reached for this request. The goal remains active; send another message or use /goal resume.", "info");
      return;
    }
    automaticContinuations++;
    const content = `Continue working toward the complete active goal. Inspect the current state and make concrete, verifiable progress. If it remains unfinished, keep it active rather than reporting completion.\n${buildGoalPrompt(goal)}`;
    return {
      entries: [{ type: "custom_message", customType: `${ENTRY_TYPE}-continuation`, content, display: false }],
      continue: true,
    };
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.mode === "tui" || ctx.mode === "rpc") ctx.ui.setStatus("persistent-goal", undefined);
  });

  pi.registerTool({
    name: "get_goal",
    label: "Get goal",
    description: "Get the current persistent goal, including its status, token usage and remaining budget.",
    parameters: Type.Object({}),
    async execute() {
      return toolResult(goal ? goalDescription(goal) : "No goal exists for this session.");
    },
  });

  pi.registerTool({
    name: "create_goal",
    label: "Create goal",
    description: "Create a persistent goal only when the user explicitly asks for goal tracking or continued work across turns. Do not infer a goal from an ordinary one-shot task. Do not replace an unfinished goal. Add token_budget only if explicitly requested.",
    parameters: CreateGoalParams,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        const created = start(params.objective, params.token_budget);
        renderStatus(ctx);
        return toolResult(`Goal started.\n${goalDescription(created)}`);
      } catch (error) {
        return toolResult(error instanceof Error ? error.message : String(error), true);
      }
    },
  });

  pi.registerTool({
    name: "update_goal",
    label: "Update goal",
    description: "Update a goal to complete, blocked, or paused. Complete only after verifying the objective is achieved. For blocked, provide the same genuine blocker on three consecutive model turns. Paused requires an explicit user request. This tool cannot resume a goal or change its budget.",
    parameters: UpdateGoalParams,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!goal) return toolResult("No goal exists.", true);
      if (params.status === "paused" && !lastUserPromptAllowsPause) {
        return toolResult("The current user prompt did not explicitly ask to pause. Keep working or ask the user.", true);
      }

      if (params.status === "blocked") {
        const reason = params.reason?.trim().replace(/\s+/g, " ");
        if (!reason) return toolResult("Provide a brief reason for the recurring blocker.", true);
        const sameTurn = goal.blockedLastTurn === currentModelTurn;
        if (sameTurn) return toolResult(`This blocker was already recorded on model turn ${currentModelTurn}; the goal remains active.`, true);
        const sameReason = reason.toLowerCase() === goal.blockedReason?.trim().toLowerCase();
        const consecutive = sameReason && goal.blockedLastTurn === currentModelTurn - 1;
        const blockedStreak = consecutive ? goal.blockedStreak + 1 : 1;
        const updated: Goal = {
          ...goal,
          status: blockedStreak >= 3 ? "blocked" : "active",
          blockedReason: reason,
          blockedStreak,
          blockedLastTurn: currentModelTurn,
          updatedAt: Date.now(),
        };
        save(updated);
        renderStatus(ctx);
        const text = blockedStreak >= 3
          ? `Goal blocked after the same issue recurred for ${blockedStreak} consecutive model turns.\n${goalDescription(updated)}`
          : `Blocker audit ${blockedStreak}/3; the goal remains active. Continue looking for a way forward and report blocked only if the same issue persists.\n${goalDescription(updated)}`;
        return toolResult(text, blockedStreak < 3);
      }

      const updated: Goal = {
        ...goal,
        status: params.status,
        blockedReason: undefined,
        blockedStreak: 0,
        blockedLastTurn: undefined,
        updatedAt: Date.now(),
      };
      save(updated);
      renderStatus(ctx);
      return toolResult(`Goal status updated to ${updated.status}.\n${goalDescription(updated)}`);
    },
  });

  pi.registerCommand("goal", {
    description: "Manage a persistent goal: set an objective directly or use status, pause, resume, complete, clear, or budget",
    getArgumentCompletions: (argumentPrefix) => {
      const prefix = argumentPrefix.trimStart();
      const spaceAt = prefix.search(/\s/u);
      if (spaceAt < 0) {
        const commands = ["status", "pause", "resume", "complete", "clear", "help", "budget", "start"];
        const matches = commands
          .filter((command) => command.startsWith(prefix))
          .map((command) => ({ value: command, label: command }));
        // With no command prefix, prioritize subcommands but preserve free-form goal text.
        return matches.length > 0 ? matches : null;
      }
      const command = prefix.slice(0, spaceAt);
      const remainder = prefix.slice(spaceAt + 1).trim();
      if (command === "budget") {
        return ["none", "10000", "50000", "100000"]
          .filter((value) => value.startsWith(remainder))
          .map((value) => ({ value, label: value }));
      }
      if (command === "start" || command === "set") return null;
      return null;
    },
    handler: async (args, ctx) => {
      const input = args.trim();
      if (!input || input === "status" || input === "show") {
        ctx.ui.notify(goal ? goalDescription(goal) : "No goal exists for this session.", "info");
        return;
      }
      if (input === "help") {
        ctx.ui.notify("/goal <objective> | status | pause | resume | complete | clear | budget <N|none>", "info");
        return;
      }

      const [verb, ...tail] = input.split(/\s+/u);
      const value = tail.join(" ").trim();
      if (verb === "start" || verb === "set") {
        try {
          const parsed = parseStartArgs(value);
          const created = start(parsed.objective, parsed.tokenBudget);
          renderStatus(ctx);
          await pi.sendMessage({
            customType: `${ENTRY_TYPE}-start`,
            content: "Start working on the active persistent goal now. Inspect the current project state, preserve the full objective, and verify before completion.",
            display: false,
            details: { goalId: created.id },
          }, { triggerTurn: true });
          ctx.ui.notify(`Goal started: ${created.objective}`, "info");
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }

      // Any non-reserved bare command is shorthand for creating and starting a goal.
      const reserved = new Set(["clear", "pause", "resume", "complete", "budget"]);
      if (!reserved.has(verb)) {
        try {
          const parsed = parseStartArgs(input);
          const created = start(parsed.objective, parsed.tokenBudget);
          renderStatus(ctx);
          await pi.sendMessage({
            customType: `${ENTRY_TYPE}-start`,
            content: "Start working on the active persistent goal now. Inspect the current project state, preserve the full objective, and verify before completion.",
            display: false,
            details: { goalId: created.id },
          }, { triggerTurn: true });
          ctx.ui.notify(`Goal started: ${created.objective}`, "info");
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }

      if (verb === "clear") {
        persist(null);
        automaticContinuations = 0;
        continuationLimitReached = false;
        renderStatus(ctx);
        ctx.ui.notify("Goal cleared.", "info");
        return;
      }
      if (!goal) {
        ctx.ui.notify("No goal exists. Set one with /goal <objective>.", "warning");
        return;
      }

      if (verb === "pause") {
        save({ ...goal, status: "paused", updatedAt: Date.now() });
      } else if (verb === "resume") {
        if (goal.status === "budget_limited" && goal.tokenBudget !== undefined && goal.tokensUsed >= goal.tokenBudget) {
          ctx.ui.notify("The token budget is exhausted. Increase or remove it with /goal budget before resuming.", "warning");
          return;
        }
        save({ ...goal, status: "active", blockedReason: undefined, blockedStreak: 0, blockedLastTurn: undefined, updatedAt: Date.now() });
        automaticContinuations = 0;
        continuationLimitReached = false;
        await pi.sendMessage({
          customType: `${ENTRY_TYPE}-resume`,
          content: "Resume the existing goal and continue from the current project state.",
          display: false,
          details: { goalId: goal.id },
        }, { triggerTurn: true });
      } else if (verb === "complete") {
        save({ ...goal, status: "complete", blockedReason: undefined, blockedStreak: 0, blockedLastTurn: undefined, updatedAt: Date.now() });
      } else if (verb === "budget") {
        if (!value) {
          ctx.ui.notify("Usage: /goal budget <positive integer|none>", "warning");
          return;
        }
        const tokenBudget = value.toLowerCase() === "none" ? undefined : Number(value);
        if (tokenBudget !== undefined && (!Number.isSafeInteger(tokenBudget) || tokenBudget < 1)) {
          ctx.ui.notify("Budget must be a positive integer or 'none'.", "error");
          return;
        }
        const updated: Goal = { ...goal, updatedAt: Date.now() };
        if (tokenBudget === undefined) delete updated.tokenBudget;
        else updated.tokenBudget = tokenBudget;
        if (updated.status === "budget_limited" && (updated.tokenBudget === undefined || updated.tokensUsed < updated.tokenBudget)) {
          updated.status = "active";
        }
        save(updated);
      } else {
        ctx.ui.notify("Unknown goal command. Use /goal <objective> or /goal help.", "warning");
        return;
      }

      renderStatus(ctx);
      ctx.ui.notify(goal ? goalDescription(goal) : "Goal cleared.", "info");
    },
  });
}
