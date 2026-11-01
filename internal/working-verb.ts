import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DEFAULT_VERBS_PATH = "D:\\Downloads\\claude-code-zh-cn-main\\verbs\\zh-CN.json";
const FALLBACK_VERBS = ["思考中", "处理中", "计算中", "构建中", "校对中", "生成中"];
const ROTATION_INTERVAL_MS = 1600;

type VerbFile = {
  mode?: unknown;
  verbs?: unknown;
};

function validVerbs(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const data = value as VerbFile;
  if (!Array.isArray(data.verbs)) return [];
  return [...new Set(data.verbs.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

async function loadVerbs(): Promise<string[]> {
  const filePath = process.env.PI_WORKING_VERBS_FILE?.trim() || DEFAULT_VERBS_PATH;
  try {
    const source = await readFile(filePath, "utf8");
    const verbs = validVerbs(JSON.parse(source));
    return verbs.length > 0 ? verbs : FALLBACK_VERBS;
  } catch {
    return FALLBACK_VERBS;
  }
}

function nextVerb(verbs: string[], previous: string | undefined): string {
  if (verbs.length === 0) return FALLBACK_VERBS[0]!;
  if (verbs.length === 1 || !previous) return verbs[randomInt(verbs.length)]!;

  let index = randomInt(verbs.length);
  while (verbs[index] === previous) index = randomInt(verbs.length);
  return verbs[index]!;
}

function canRenderWorkingUI(ctx: ExtensionContext): boolean {
  return ctx.mode === "tui";
}

/** Replace Pi's generic working label with a rotating verb from the configured JSON file. */
export function registerWorkingVerbs(pi: ExtensionAPI): void {
  let verbs = [...FALLBACK_VERBS];
  let previousVerb: string | undefined;
  let rotationTimer: ReturnType<typeof setInterval> | undefined;
  let activeContext: ExtensionContext | undefined;

  const rotate = (ctx: ExtensionContext): void => {
    if (!canRenderWorkingUI(ctx)) return;
    previousVerb = nextVerb(verbs, previousVerb);
    ctx.ui.setWorkingMessage(previousVerb);
  };

  const stopRotation = (): void => {
    if (rotationTimer !== undefined) {
      clearInterval(rotationTimer);
      rotationTimer = undefined;
    }
    activeContext = undefined;
  };

  const startRotation = (ctx: ExtensionContext): void => {
    stopRotation();
    activeContext = ctx;
    rotate(ctx);
    rotationTimer = setInterval(() => {
      if (activeContext && !activeContext.isIdle()) rotate(activeContext);
    }, ROTATION_INTERVAL_MS);
  };

  const restorePiWorkingUI = (ctx: ExtensionContext): void => {
    stopRotation();
    if (!canRenderWorkingUI(ctx)) return;
    ctx.ui.setWorkingMessage();
    ctx.ui.setWorkingIndicator();
  };

  pi.on("session_start", async (_event, ctx) => {
    verbs = await loadVerbs();
    previousVerb = undefined;
    if (canRenderWorkingUI(ctx)) {
      // The changing text is the indicator; remove Pi's generic spinner prefix.
      ctx.ui.setWorkingIndicator({ frames: [""] });
      ctx.ui.setWorkingVisible(true);
      rotate(ctx);
    }
  });

  pi.on("agent_start", async (_event, ctx) => startRotation(ctx));
  pi.on("turn_start", async (_event, ctx) => startRotation(ctx));
  pi.on("message_start", async (event, ctx) => {
    if (event.message.role === "assistant") rotate(ctx);
  });
  pi.on("message_update", async (event, ctx) => {
    const type = event.assistantMessageEvent.type;
    if (type === "thinking_start" || type === "text_start" || type === "toolcall_start") rotate(ctx);
  });
  pi.on("tool_execution_start", async (_event, ctx) => rotate(ctx));
  pi.on("before_provider_request", async (_event, ctx) => rotate(ctx));
  pi.on("session_before_compact", async (_event, ctx) => rotate(ctx));
  pi.on("agent_end", async (_event, ctx) => {
    stopRotation();
  });

  pi.on("session_shutdown", async (_event, ctx) => restorePiWorkingUI(ctx));
}
