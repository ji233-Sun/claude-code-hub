/**
 * Default test configuration shared by client components
 *
 * NOTE: This module must stay free of server-only imports (proxy agents,
 * node APIs, ...) because it is bundled into "use client" components.
 */

import { normalizeAllowedModelRules } from "@/lib/allowed-model-rules";
import type { AllowedModelRuleInput, ProviderType } from "@/types/provider";

export const DEFAULT_MODELS: Record<ProviderType, string> = {
  claude: "claude-haiku-4-5-20251001",
  "claude-auth": "claude-haiku-4-5-20251001",
  codex: "gpt-5.5",
  "openai-compatible": "gpt-4.1-mini",
  gemini: "gemini-2.5-flash",
  "gemini-cli": "gemini-2.5-flash",
};

export function resolveProviderType(providerType?: ProviderType | null): ProviderType {
  return providerType ?? "claude";
}

/**
 * Resolve the default test model for a provider.
 * Prefers the first exact-match allowed model (whitelist), falling back to
 * the protocol-level default model of the provider type.
 */
export function resolveDefaultTestModel(
  providerType?: ProviderType | null,
  allowedModels?: AllowedModelRuleInput[] | null
): string {
  const rules = normalizeAllowedModelRules(allowedModels ?? null) ?? [];
  const firstExact = rules.find((rule) => rule.matchType === "exact")?.pattern;
  return firstExact ?? DEFAULT_MODELS[resolveProviderType(providerType)];
}

/** Gemini 系列冷启动较慢，使用更宽松的默认超时 */
export function getDefaultTestTimeoutMs(providerType?: ProviderType | null): number {
  const resolved = resolveProviderType(providerType);
  return resolved === "gemini" || resolved === "gemini-cli" ? 60_000 : 15_000;
}
