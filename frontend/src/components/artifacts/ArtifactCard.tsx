import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Clipboard, FileCode2 } from "lucide-react";

import MarkdownRenderer from "../common/MarkdownRenderer";
import { ChatArtifact } from "../../types";
import { cn } from "../../utils";

export default function ArtifactCard({
  artifact,
  defaultOpen = false,
}: {
  artifact: ChatArtifact;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyArtifact = async () => {
    await navigator.clipboard.writeText(artifact.content || "");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-line bg-surface-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
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
                className={cn(
                  "rounded px-2 py-1 text-[11px]",
                  !raw ? "bg-accent text-accent-foreground" : "text-fg-muted"
                )}
              >
                Rendered
              </button>
              <button
                type="button"
                onClick={() => setRaw(true)}
                className={cn(
                  "rounded px-2 py-1 text-[11px]",
                  raw ? "bg-accent text-accent-foreground" : "text-fg-muted"
                )}
              >
                Raw
              </button>
            </div>
            <button
              type="button"
              onClick={() => void copyArtifact()}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[11px] text-fg-muted hover:text-fg"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
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
