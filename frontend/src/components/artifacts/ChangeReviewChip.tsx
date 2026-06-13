import { FileCode2 } from "lucide-react";

import { ChatArtifact } from "../../types";

export default function ChangeReviewChip({
  artifact,
  onCommit,
  onRevert,
}: {
  artifact: ChatArtifact;
  onCommit?: (artifact: ChatArtifact) => void;
  onRevert?: (artifact: ChatArtifact) => void;
}) {
  const files = artifact.changed_files || [];
  const label =
    files.length > 0
      ? `${files.length} file${files.length === 1 ? "" : "s"} changed`
      : artifact.summary;
  return (
    <div
      className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[11.5px] font-semibold text-accent transition-colors hover:bg-accent/15"
      title={files.slice(0, 8).join("\n") || artifact.title}
    >
      <FileCode2 className="h-3.5 w-3.5" />
      <span>{label}</span>
      <span className="text-accent/70">Review</span>
      {files.length > 0 && artifact.workdir && (
        <span className="ml-1 inline-flex items-center gap-1">
          {onCommit && (
            <button
              type="button"
              onClick={() => onCommit(artifact)}
              className="rounded border border-accent/30 bg-surface-1 px-1.5 py-0.5 text-[10.5px] text-accent hover:bg-accent/10"
            >
              Commit
            </button>
          )}
          {onRevert && (
            <button
              type="button"
              onClick={() => onRevert(artifact)}
              className="rounded border border-accent/30 bg-surface-1 px-1.5 py-0.5 text-[10.5px] text-accent hover:bg-accent/10"
            >
              Revert
            </button>
          )}
        </span>
      )}
    </div>
  );
}
