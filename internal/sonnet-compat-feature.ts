import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SONNET_MODEL_ID = "claude-sonnet-5-5";
const ANTHROPIC_MESSAGES_API = "anthropic-messages";

type JsonObject = Record<string, unknown>;
type ThinkingDisplay = "summarized" | "omitted" | "updates" | null;

type ModelLike = {
  api?: unknown;
  id?: unknown;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThinkingDisplay(value: unknown): value is ThinkingDisplay {
  return value === "summarized" || value === "omitted" || value === "updates" || value === null;
}

function isSonnet55Model(model: ModelLike | undefined): boolean {
  return model?.api === ANTHROPIC_MESSAGES_API && model.id === SONNET_MODEL_ID;
}

function adaptiveConfigFromEnabled(thinking: JsonObject): JsonObject {
  const adaptive: JsonObject = { type: "adaptive" };
  if (isThinkingDisplay(thinking.display)) adaptive.display = thinking.display;

  if (isObject(thinking.block_binding)) {
    const behavior = thinking.block_binding.prefix_mismatch_behavior;
    if (behavior === undefined || behavior === "error" || behavior === "drop_block") {
      adaptive.block_binding = { ...thinking.block_binding };
    }
  }
  return adaptive;
}

/**
 * Convert the legacy thinking payload emitted by older/custom Pi model entries.
 * Sonnet 5.5 accepts adaptive thinking, between_tools, or no thinking field.
 */
export function normalizeSonnet55Payload(payload: unknown, model: ModelLike | undefined): unknown {
  if (!isSonnet55Model(model) || !isObject(payload)) return payload;

  const thinking = payload.thinking;
  if (!isObject(thinking)) return payload;

  if (thinking.type === "adaptive" || thinking.type === "between_tools") return payload;

  const normalized = { ...payload };
  if (thinking.type === "enabled") {
    normalized.thinking = adaptiveConfigFromEnabled(thinking);
    return normalized;
  }

  if (thinking.type === "disabled") {
    delete normalized.thinking;
    return normalized;
  }

  return payload;
}

/** Apply the Sonnet 5.5 fix to Anthropic Messages requests only. */
export function registerSonnetCompatibility(pi: ExtensionAPI): void {
  pi.on("before_provider_request", async (event, ctx) => normalizeSonnet55Payload(event.payload, ctx.model));
}

export default registerSonnetCompatibility;
