import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clipboard,
  FileCode2,
  GitCommitHorizontal,
  Undo2,
} from "lucide-react";

import MarkdownRenderer from "../common/MarkdownRenderer";
import { ChatArtifact } from "../../types";
import { cn } from "../../utils";
import { copyTextToClipboard } from "../../utils/clipboard";

export default function ArtifactCard({
  artifact,
  defaultOpen = false,
  onCommit,
  onRevert,
}: {
  artifact: ChatArtifact;
  defaultOpen?: boolean;
  onCommit?: (artifact: ChatArtifact) => void;
  onRevert?: (artifact: ChatArtifact) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [raw, setRaw] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const copyArtifact = async () => {
    window.clearTimeout(resetTimer.current);
    setCopyStatus("copying");

    const copied = await copyTextToClipboard(artifact.content || "");
    setCopyStatus(copied ? "copied" : "failed");
    resetTimer.current = window.setTimeout(() => setCopyStatus("idle"), copied ? 1600 : 3000);
  };

  const copyLabel =
    copyStatus === "copying"
      ? "Copying…"
      : copyStatus === "copied"
        ? "Copied"
        : copyStatus === "failed"
          ? "Copy failed"
          : "Copy";

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-line bg-surface-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-2"
      >
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-accent">
          <FileCode2 className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[12.5px] font-semibold text-fg">
              {artifact.title || "Generated output"}
            </p>
            <span className="rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-dim">
              {artifact.content_type || "text"}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-fg-muted">
            {artifact.summary || "Full output is available."}
          </p>
        </div>
        {open ? (
          <ChevronDown className="mt-1 h-4 w-4 text-fg-dim" />
        ) : (
          <ChevronRight className="mt-1 h-4 w-4 text-fg-dim" />
        )}
      </button>
      {open && (
        <div className="border-t border-line">
          <div className="flex items-center justify-between gap-2 px-3.5 py-2">
            <div className="flex items-center gap-1 rounded-md border border-line bg-surface-2 p-0.5">
              <button
                type="button"
                onClick={() => setRaw(false)}
                aria-pressed={!raw}
                className={cn(
                  "min-h-11 rounded px-2 py-1 text-[11.5px]",
                  !raw ? "bg-accent text-accent-foreground" : "text-fg-muted",
                )}
              >
                Rendered
              </button>
              <button
                type="button"
                onClick={() => setRaw(true)}
                aria-pressed={raw}
                className={cn(
                  "min-h-11 rounded px-2 py-1 text-[11.5px]",
                  raw ? "bg-accent text-accent-foreground" : "text-fg-muted",
                )}
              >
                Raw
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {artifact.changed_files?.length && artifact.workdir && onCommit && onRevert ? (
                <>
                  <button
                    type="button"
                    onClick={() => onCommit(artifact)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2.5 text-[11.5px] font-semibold text-accent hover:bg-accent/15"
                  >
                    <GitCommitHorizontal className="h-3.5 w-3.5" />
                    Commit
                  </button>
                  <button
                    type="button"
                    onClick={() => onRevert(artifact)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 text-[11.5px] font-semibold text-fg-muted hover:text-fg"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Revert
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => void copyArtifact()}
                disabled={copyStatus === "copying"}
                title={
                  copyStatus === "failed" ? "Unable to copy this output. Try again." : undefined
                }
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 text-[11.5px] text-fg-muted hover:text-fg"
              >
                {copyStatus === "copied" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : copyStatus === "failed" ? (
                  <CircleAlert className="h-3.5 w-3.5" />
                ) : (
                  <Clipboard className="h-3.5 w-3.5" />
                )}
                {copyLabel}
              </button>
            </div>
            <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {copyStatus === "copied"
                ? "Output copied to clipboard."
                : copyStatus === "failed"
                  ? "Unable to copy this output to the clipboard."
                  : ""}
            </span>
          </div>
          <div className="max-h-[520px] overflow-auto border-t border-line px-3.5 py-3">
            {raw ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-fg-muted">
                {artifact.content}
              </pre>
            ) : (
              <MarkdownRenderer content={artifact.content || ""} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
