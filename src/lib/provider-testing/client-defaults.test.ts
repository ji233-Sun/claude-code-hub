import { describe, expect, test } from "vitest";
import {
  DEFAULT_MODELS,
  getDefaultTestTimeoutMs,
  resolveDefaultTestModel,
  resolveProviderType,
} from "./client-defaults";

describe("resolveProviderType", () => {
  test("缺省时应该回退到 claude", () => {
    expect(resolveProviderType(null)).toBe("claude");
    expect(resolveProviderType(undefined)).toBe("claude");
    expect(resolveProviderType("codex")).toBe("codex");
  });
});

describe("resolveDefaultTestModel", () => {
  test("没有白名单时应该使用类型默认模型", () => {
    expect(resolveDefaultTestModel("claude")).toBe(DEFAULT_MODELS.claude);
    expect(resolveDefaultTestModel("codex", null)).toBe(DEFAULT_MODELS.codex);
    expect(resolveDefaultTestModel("gemini", [])).toBe(DEFAULT_MODELS.gemini);
    expect(resolveDefaultTestModel(null)).toBe(DEFAULT_MODELS.claude);
  });

  test("应该优先使用第一个精确匹配的白名单模型", () => {
    expect(resolveDefaultTestModel("claude", ["my-model", "other-model"])).toBe("my-model");
    expect(
      resolveDefaultTestModel("openai-compatible", [
        { matchType: "prefix", pattern: "gpt-" },
        { matchType: "exact", pattern: "deepseek-chat" },
      ])
    ).toBe("deepseek-chat");
  });

  test("白名单全是非精确规则时应该回退到类型默认模型", () => {
    expect(resolveDefaultTestModel("claude", [{ matchType: "prefix", pattern: "claude-" }])).toBe(
      DEFAULT_MODELS.claude
    );
  });
});

describe("getDefaultTestTimeoutMs", () => {
  test("gemini 系列应该使用 60 秒，其余 15 秒", () => {
    expect(getDefaultTestTimeoutMs("gemini")).toBe(60_000);
    expect(getDefaultTestTimeoutMs("gemini-cli")).toBe(60_000);
    expect(getDefaultTestTimeoutMs("claude")).toBe(15_000);
    expect(getDefaultTestTimeoutMs("codex")).toBe(15_000);
    expect(getDefaultTestTimeoutMs(null)).toBe(15_000);
  });
});
