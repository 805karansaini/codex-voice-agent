import type { CodexModel } from "../types";

export function defaultCodexModel(models: CodexModel[]): CodexModel | undefined {
  return models.find((model) => model.isDefault) ?? models[0];
}

export function defaultReasoningEffort(model: CodexModel | undefined): string {
  if (!model) return "";
  const supported = model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort);
  if (model.defaultReasoningEffort && supported.includes(model.defaultReasoningEffort)) {
    return model.defaultReasoningEffort;
  }
  return supported[0] ?? "";
}
