import type { ChatArtifact } from "../types";

export function appendArtifact(
  artifacts: ChatArtifact[] | undefined,
  artifact: ChatArtifact | null | undefined
): ChatArtifact[] {
  if (!artifact?.id) return artifacts || [];
  const current = artifacts || [];
  if (current.some((item) => item.id === artifact.id)) return current;
  return [...current, artifact];
}

export function appendArtifacts(
  artifacts: ChatArtifact[] | undefined,
  ...items: (ChatArtifact | null | undefined)[]
): ChatArtifact[] {
  return items.reduce((current, item) => appendArtifact(current, item), artifacts || []);
}

export function changeArtifacts(artifacts: ChatArtifact[] | undefined): ChatArtifact[] {
  return (artifacts || []).filter(
    (artifact) => artifact.content_type === "diff" || artifact.source === "git_diff"
  );
}
