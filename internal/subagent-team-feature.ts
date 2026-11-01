import { randomUUID } from "node:crypto";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const RPC_REQUEST_EVENT = "subagents:rpc:v1:request";
const RPC_READY_EVENT = "subagents:rpc:v1:ready";
const RPC_REPLY_EVENT_PREFIX = "subagents:rpc:v1:reply:";
const RPC_TIMEOUT_MS = 15_000;
const MAX_TASK_LENGTH = 5_000;
const MAX_MODEL_LENGTH = 256;
const MAX_TEAM_MEMBERS = 4;

type RpcReply = {
  version?: number;
  requestId?: string;
  success?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
};

type TeamMember = { agent: string; focus: string; model?: string };

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
  isError: boolean;
};

const DelegateParams = Type.Object({
  agent: Type.String({ minLength: 1, maxLength: 96, description: "Configured pi-subagents agent name." }),
  task: Type.String({ minLength: 1, maxLength: MAX_TASK_LENGTH, description: "A bounded task for the agent." }),
  model: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_MODEL_LENGTH, description: "Optional per-run model override; use provider/id when ambiguous." })),
});

const TeamParams = Type.Object({
  task: Type.String({ minLength: 1, maxLength: MAX_TASK_LENGTH, description: "The shared team objective." }),
  members: Type.Array(Type.Object({
    agent: Type.String({ minLength: 1, maxLength: 96, description: "Configured pi-subagents agent name." }),
    focus: Type.String({ minLength: 1, maxLength: 1_000, description: "This teammate's distinct focus." }),
    model: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_MODEL_LENGTH, description: "Optional per-run model override for this teammate; use provider/id when ambiguous." })),
  }), { minItems: 2, maxItems: MAX_TEAM_MEMBERS, description: "Two to four independent teammates." }),
});

function textResult(text: string, details: Record<string, unknown> = {}, isError = false): ToolResult {
  return { content: [{ type: "text", text }], details, isError };
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= maxLength ? text : undefined;
}

function hasSubagentTool(ctx: ExtensionContext): boolean {
  return ctx.tools.some((tool) => tool.name === "subagent");
}

function requestRpc(pi: ExtensionAPI, method: string, params: Record<string, unknown>): Promise<RpcReply> {
  const requestId = randomUUID();
  const replyEvent = `${RPC_REPLY_EVENT_PREFIX}${requestId}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const unsubscribe = pi.events.on(replyEvent, (reply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      const result = reply as RpcReply;
      if (result.version !== 1 || result.requestId !== requestId) {
        reject(new Error("pi-subagents returned an invalid RPC reply."));
      } else if (!result.success) {
        reject(new Error(result.error?.message ?? "pi-subagents request failed."));
      } else {
        resolve(result);
      }
    });

    timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(new Error("pi-subagents did not reply within 15 seconds."));
    }, RPC_TIMEOUT_MS);

    try {
      pi.events.emit(RPC_REQUEST_EVENT, { version: 1, requestId, method, params });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      reject(error);
    }
  });
}

function resultText(reply: RpcReply): string {
  const data = reply.data;
  if (typeof data !== "object" || data === null) return "Subagent request accepted.";
  const record = data as Record<string, unknown>;
  const details = record.details as Record<string, unknown> | undefined;
  const runId = typeof record.runId === "string" ? record.runId
    : typeof details?.runId === "string" ? details.runId : undefined;
  const state = typeof record.state === "string" ? record.state
    : typeof details?.state === "string" ? details.state : undefined;
  const receipt = typeof record.text === "string" ? record.text.trim() : "";
  return [receipt || "Subagent request accepted.", runId ? `Run: ${runId}` : "", state ? `State: ${state}` : ""]
    .filter(Boolean).join("\n");
}

function buildTeamWorkflow(task: string, members: TeamMember[]): string {
  const roster = members.map((member, index) => ({
    key: `member-${index + 1}`,
    agent: member.agent,
    ...(member.model ? { model: member.model } : {}),
    task: [
      `Shared team objective: ${task}`,
      `Your distinct focus: ${member.focus}`,
      "Work independently. Return concise, actionable discoveries and cite relevant files or evidence. Keep your final answer focused on your assigned focus and the shared objective.",
      "When the orchestrator relays teammate discoveries, incorporate them where relevant and note disagreements instead of silently discarding them.",
    ].join("\n\n"),
  }));

  return [
    `const members = ${JSON.stringify(roster)};`,
    "const pending = members.map((member) => ({ key: member.key, member, promise: runs.run({ key: member.key, agent: member.agent, task: member.task, ...(member.model ? { model: member.model } : {}) }) }));",
    "const results = [];",
    "while (pending.length > 0) {",
    "  const settled = await Promise.race(pending.map((entry) => entry.promise.then((result) => ({ entry, result }))));",
    "  const index = pending.findIndex((entry) => entry.key === settled.entry.key);",
    "  const [entry] = pending.splice(index, 1);",
    "  const output = typeof settled.result.output === \"string\" ? settled.result.output.slice(0, 3000) : JSON.stringify(settled.result.structuredOutput ?? settled.result.output ?? \"\").slice(0, 3000);",
    "  results.push({ agent: entry.member.agent, key: entry.key, ok: settled.result.ok, output });",
    "  if (output && pending.length > 0) {",
    "    const message = `Teammate ${entry.member.agent} (${entry.key}) finished and found:\\n${output}\\n\\nIncorporate this discovery into your work if relevant. Report conflicts explicitly. Continue your own assigned focus.`;",
    "    await Promise.all(pending.map((other) => runs.steer(other.key, message, { mode: \"follow_up\" }).then((receipt) => receipt, () => null)));",
    "  }",
    "}",
    "return results;",
  ].join("\n");
}

function renderResult(result: { content: Array<{ type: string; text?: string }>; isError?: boolean }, _options: unknown, theme: Theme): Text {
  const line = result.content[0]?.text ?? "";
  return new Text(result.isError ? theme.fg("error", line) : theme.fg("text", line), 0, 0);
}

export function registerSubagentTeam(pi: ExtensionAPI): void {
  let rpcReady = false;
  const unsubscribeReady = pi.events.on(RPC_READY_EVENT, () => { rpcReady = true; });
  pi.on("session_shutdown", () => { rpcReady = false; });

  const unavailable = (ctx: ExtensionContext): string | undefined => {
    if (!hasSubagentTool(ctx)) return "Install and enable pi-subagents to use delegate and team.";
    if (!rpcReady) return "pi-subagents RPC is not ready in this session. Reload the session and try again.";
    return undefined;
  };

  pi.registerTool({
    name: "delegate",
    label: "Delegate task",
    description: "Delegate one bounded task to a configured pi-subagents agent, optionally overriding its model for this run. Returns a background run receipt.",
    parameters: DelegateParams,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const problem = unavailable(ctx);
      if (problem) return textResult(problem, { error: problem }, true);
      const agent = cleanText(params.agent, 96);
      const task = cleanText(params.task, MAX_TASK_LENGTH);
      const model = params.model === undefined ? undefined : cleanText(params.model, MAX_MODEL_LENGTH);
      if (!agent || !task || (params.model !== undefined && !model)) {
        return textResult("agent and task must be non-empty; model, when provided, must be non-empty and within its length limit.", {}, true);
      }
      try {
        const reply = await requestRpc(pi, "spawn", { agent, task, ...(model ? { model } : {}) });
        return textResult(resultText(reply), { method: "spawn", data: reply.data as unknown });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return textResult(message, { error: message }, true);
      }
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("delegate ")) + theme.fg("accent", String(args.agent ?? "")), 0, 0);
    },
    renderResult,
  });

  pi.registerTool({
    name: "team",
    label: "Create teammate team",
    description: "Start a bounded team of 2-4 configured pi-subagents agents. Each member may override its model for this run. Members work in parallel; when a member finishes, its concise findings are sent to the remaining teammates as follow-up context. The workflow has a 15-minute deadline and returns a background run receipt.",
    parameters: TeamParams,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const problem = unavailable(ctx);
      if (problem) return textResult(problem, { error: problem }, true);
      const task = cleanText(params.task, MAX_TASK_LENGTH);
      const members = Array.isArray(params.members) ? params.members as TeamMember[] : [];
      if (!task || members.length < 2 || members.length > MAX_TEAM_MEMBERS
        || members.some((member) => !cleanText(member.agent, 96) || !cleanText(member.focus, 1_000)
          || (member.model !== undefined && !cleanText(member.model, MAX_MODEL_LENGTH)))) {
        return textResult(`task must be non-empty and members must contain 2-${MAX_TEAM_MEMBERS} valid agent/focus pairs; model is optional.`, {}, true);
      }
      const normalizedMembers = members.map((member) => ({
        agent: member.agent.trim(),
        focus: member.focus.trim(),
        ...(member.model ? { model: member.model.trim() } : {}),
      }));
      try {
        const reply = await requestRpc(pi, "spawn", {
          script: buildTeamWorkflow(task, normalizedMembers),
          options: { timeoutMs: 900_000 },
        });
        return textResult(resultText(reply), { method: "spawn", teamSize: normalizedMembers.length, data: reply.data as unknown });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return textResult(message, { error: message }, true);
      }
    },
    renderCall(args, theme) {
      const count = Array.isArray(args.members) ? args.members.length : 0;
      return new Text(theme.fg("toolTitle", theme.bold("team ")) + theme.fg("accent", `${count} teammates`), 0, 0);
    },
    renderResult,
  });

  pi.on("session_shutdown", () => {
    unsubscribeReady();
  });
}

export default registerSubagentTeam;
