import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SONNET_MODEL_ID = "claude-sonnet-5-5";
const OPUS_MODEL_ID = "claude-opus-5-5";
const BLCC_PROVIDER = "blcc";
const ANTHROPIC_MESSAGES_API = "anthropic-messages";

type JsonObject = Record<string, unknown>;
type ThinkingDisplay = "summarized" | "omitted" | "updates" | null;

type ModelLike = {
  api?: unknown;
  id?: unknown;
  provider?: unknown;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThinkingDisplay(value: unknown): value is ThinkingDisplay {
  return value === "summarized" || value === "omitted" || value === "updates" || value === null;
}

function isCompatibilityTarget(model: ModelLike | undefined): boolean {
  if (model?.api !== ANTHROPIC_MESSAGES_API) return false;
  if (model.id === SONNET_MODEL_ID) return true;
  return model.id === OPUS_MODEL_ID && model.provider === BLCC_PROVIDER;
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
 * Convert legacy thinking payloads for Claude 5.5 Anthropic Messages models.
 * Sonnet 5.5 is matched by model ID; Opus 5.5 is limited to the BLCC provider.
 * Both models accept adaptive thinking, between_tools, or no thinking field.
 */
export function normalizeSonnet55Payload(payload: unknown, model: ModelLike | undefined): unknown {
  if (!isCompatibilityTarget(model) || !isObject(payload)) return payload;

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

/** Apply the Claude 5.5 fix to targeted Anthropic Messages requests only. */
export function registerSonnetCompatibility(pi: ExtensionAPI): void {
  pi.on("before_provider_request", async (event, ctx) => normalizeSonnet55Payload(event.payload, ctx.model));
}

export default registerSonnetCompatibility;
