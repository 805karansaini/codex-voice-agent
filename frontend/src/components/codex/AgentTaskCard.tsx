import { Bot, CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import { useState } from "react";

import type { ChatArtifact, Message } from "../../types";
import {
  presentTaskArtifacts,
  taskAgentName,
  taskState,
  taskSummary,
} from "../../utils/taskPresentation";
import { cn } from "../../utils";
import ArtifactCard from "../artifacts/ArtifactCard";
import MarkdownRenderer from "../common/MarkdownRenderer";
import CodexTimeline from "./CodexTimeline";

type AgentTaskCardProps = {
  message: Message;
  onCommitChangeReview: (artifact: ChatArtifact) => void;
  onRevertChangeReview: (artifact: ChatArtifact) => void;
  copyControl?: React.ReactNode;
};

export default function AgentTaskCard({
  message,
  onCommitChangeReview,
  onRevertChangeReview,
  copyControl,
}: AgentTaskCardProps) {
  const [open, setOpen] = useState(message.streaming);
  const state = taskState(message);
  const storedAgentName = taskAgentName(message);
  const agentName =
    state === "running" && storedAgentName === "Claude" ? "Claudex" : storedAgentName;
  const { changes, outputs } = presentTaskArtifacts(message.artifacts, message.text);
  const eventCount = message.codexEvents?.length || 0;
  const changedFileCount = new Set(changes.flatMap((artifact) => artifact.changed_files || []))
    .size;
  const StateIcon =
    state === "running" ? LoaderCircle : state === "failed" ? CircleAlert : CheckCircle2;

  return (
    <div className="mt-1 overflow-hidden rounded-xl border border-line bg-surface-1 shadow-sm">
      <button
        type="button"
        className="flex min-h-11 w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-2"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
          <Bot className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[12.5px] font-semibold text-fg">{agentName} task</span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium capitalize",
                state === "failed"
                  ? "border-danger/25 bg-danger/10 text-danger"
                  : state === "running"
                    ? "border-accent/25 bg-accent/10 text-accent"
                    : "border-success/25 bg-success/10 text-success",
              )}
            >
              <StateIcon className={cn("h-3 w-3", state === "running" && "animate-spin")} />
              {state}
            </span>
            {changedFileCount > 0 && (
              <span className="text-[11px] text-fg-muted">
                {changedFileCount} file{changedFileCount === 1 ? "" : "s"} changed
              </span>
            )}
          </span>
          <span className="mt-1 block line-clamp-2 text-[12px] leading-relaxed text-fg-muted">
            {taskSummary(message)}
          </span>
        </span>
        <span className="mt-1 text-[11px] font-medium text-fg-muted">{open ? "Hide" : "View"}</span>
      </button>

      {open && (
        <div className="border-t border-line-soft px-3.5 py-3">
          {message.text && (
            <div className="text-[14px] leading-relaxed text-fg/95">
              <MarkdownRenderer content={message.text} />
            </div>
          )}

          {changes.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {changes.map((artifact) => (
                <ArtifactCard
                  key={artifact.id}
                  artifact={artifact}
                  defaultOpen
                  onCommit={onCommitChangeReview}
                  onRevert={onRevertChangeReview}
                />
              ))}
            </div>
          )}

          {outputs.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {outputs.map((artifact) => (
                <ArtifactCard key={artifact.id} artifact={artifact} />
              ))}
            </div>
          )}

          {eventCount > 0 || message.codexStatus ? (
            <CodexTimeline events={message.codexEvents} status={message.codexStatus} />
          ) : null}

          {copyControl && <div className="mt-2 flex justify-end">{copyControl}</div>}
        </div>
      )}
    </div>
  );
}
