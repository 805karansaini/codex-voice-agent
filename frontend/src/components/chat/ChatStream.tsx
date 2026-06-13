import { FolderPlus, Plus, SquareTerminal, Zap } from "lucide-react";
import type { RefObject } from "react";

import type { ChatArtifact, Message, Project } from "../../types";
import { cn } from "../../utils";
import { changeArtifacts } from "../../utils/artifacts";
import ArtifactCard from "../artifacts/ArtifactCard";
import ChangeReviewChip from "../artifacts/ChangeReviewChip";
import CodexTimeline from "../codex/CodexTimeline";
import MarkdownRenderer from "../common/MarkdownRenderer";

type ChatStreamProps = {
  isMobile: boolean;
  busy: boolean;
  mode: "agent" | "codex";
  activeProject?: Project | null;
  messages: Message[];
  suggestions: string[];
  messageEndRef: RefObject<HTMLDivElement | null>;
  onAddProject: () => void;
  onSuggestion: (suggestion: string) => void;
  onCommitChangeReview: (artifact: ChatArtifact) => void;
  onRevertChangeReview: (artifact: ChatArtifact) => void;
};

export default function ChatStream({
  isMobile,
  busy,
  mode,
  activeProject,
  messages,
  suggestions,
  messageEndRef,
  onAddProject,
  onSuggestion,
  onCommitChangeReview,
  onRevertChangeReview,
}: ChatStreamProps) {
  return (
    <section
      aria-busy={busy || messages.some((message) => message.streaming)}
      aria-label="Chat conversation"
      className={cn("flex-1 overflow-y-auto scroll-smooth", isMobile ? "px-3 py-4" : "px-5 py-6")}
    >
      <div className="mx-auto flex max-w-[760px] flex-col gap-6">
        {!activeProject ? (
          <div className="text-center py-20 px-4 max-w-md mx-auto">
            <div className="w-12 h-12 rounded-xl bg-accent/15 text-accent flex items-center justify-center mx-auto mb-4 border border-accent/25">
              <FolderPlus className="h-6 w-6" />
            </div>
            <h3 className="text-base font-semibold">Connect a Project</h3>
            <p className="text-[13px] text-fg-muted mt-1.5 leading-relaxed">
              A project links the agent to a folder on your system. It can read files, write code,
              run commands, and execute tests directly in place.
            </p>
            <button
              onClick={onAddProject}
              className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:brightness-110 transition-all glow-accent"
            >
              <Plus className="h-3.5 w-3.5" />
              Add project
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="py-12 px-4 text-center max-w-xl mx-auto">
            <div className="w-10 h-10 rounded-lg bg-surface-2 border border-line flex items-center justify-center mx-auto mb-4 text-fg-muted">
              <SquareTerminal className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-semibold tracking-tight">{activeProject.name}</h3>
            <p className="text-[12.5px] font-mono text-accent mt-1 truncate max-w-md mx-auto">
              {activeProject.path}
            </p>
            <p className="text-[13px] text-fg-muted mt-2">
              Enter a prompt below or start a live voice session.
            </p>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left max-w-lg mx-auto">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => onSuggestion(suggestion)}
                  className="flex items-center gap-2 p-3 text-[12.5px] rounded-lg border border-line bg-surface-1 hover:bg-surface-2 transition-all group"
                >
                  <Zap className="h-3.5 w-3.5 text-accent shrink-0 group-hover:scale-110 transition-transform" />
                  <span className="truncate text-fg-muted group-hover:text-fg">{suggestion}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => {
            const isUser = message.role === "user";
            if (isUser) {
              return (
                <article
                  key={message.id}
                  className="flex w-full justify-end animate-in fade-in duration-200"
                >
                  <div
                    className={cn(
                      "rounded-xl px-4 py-3 text-[13.5px] leading-relaxed shadow-sm bg-surface-2 border border-line text-fg",
                      isMobile ? "max-w-[90%]" : "max-w-[80%]",
                    )}
                  >
                    {message.text ? <MarkdownRenderer content={message.text} /> : null}
                  </div>
                </article>
              );
            }

            const diffs = changeArtifacts(message.artifacts);
            return (
              <article
                key={message.id}
                className="flex w-full justify-start animate-in fade-in duration-200"
              >
                <div
                  className={cn(
                    "flex-1 text-[13.5px] leading-relaxed text-fg/95 px-1 py-1",
                    isMobile ? "max-w-[98%]" : "max-w-[90%]",
                  )}
                >
                  {message.text ? (
                    <MarkdownRenderer content={message.text} />
                  ) : (
                    message.streaming && (
                      <div className="flex flex-col gap-1.5 py-1">
                        <span className="h-2 bg-fg-dim/15 rounded w-full animate-pulse" />
                        <span className="h-2 bg-fg-dim/15 rounded w-4/5 animate-pulse" />
                        <span className="h-2 bg-fg-dim/15 rounded w-3/5 animate-pulse" />
                      </div>
                    )
                  )}
                  {message.streaming && message.text && <span className="caret animate-pulse" />}
                  {diffs.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {diffs.map((artifact) => (
                        <ChangeReviewChip
                          key={artifact.id}
                          artifact={artifact}
                          onCommit={onCommitChangeReview}
                          onRevert={onRevertChangeReview}
                        />
                      ))}
                    </div>
                  )}
                  {message.artifacts && message.artifacts.length > 0 && (
                    <div className="mt-3 flex flex-col gap-2">
                      {message.artifacts.map((artifact) => (
                        <ArtifactCard
                          key={artifact.id}
                          artifact={artifact}
                          defaultOpen={artifact.content_type === "diff"}
                        />
                      ))}
                    </div>
                  )}
                  {(message.usedCodex ||
                    (message.codexEvents && message.codexEvents.length > 0)) && (
                    <CodexTimeline events={message.codexEvents} status={message.codexStatus} />
                  )}
                </div>
              </article>
            );
          })
        )}

        {busy && mode === "agent" && !messages.some((message) => message.streaming) && (
          <article className="flex justify-start w-full">
            <div className={cn("flex-1 px-1 py-1", isMobile ? "max-w-[98%]" : "max-w-[90%]")}>
              <div className="flex flex-col gap-1.5 py-1">
                <span className="h-2 bg-fg-dim/15 rounded w-full animate-pulse" />
                <span className="h-2 bg-fg-dim/15 rounded w-5/6 animate-pulse" />
                <span className="h-2 bg-fg-dim/15 rounded w-2/3 animate-pulse" />
              </div>
            </div>
          </article>
        )}

        <div ref={messageEndRef} />
      </div>
    </section>
  );
}
