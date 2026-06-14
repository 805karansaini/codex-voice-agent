import {
  Folder,
  GitBranch,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Sparkles,
  SquareTerminal,
} from "lucide-react";

import type { MobileView } from "../../hooks/useAppLayout";
import type { ProjectInfo, SearchResult } from "../../types";
import { cn } from "../../utils";

export type AppTitleBarProps = {
  isMobile: boolean;
  mobileView: MobileView;
  activeProjectName: string;
  activeChatTitle?: string;
  projectInfo: ProjectInfo | null;
  searchQuery: string;
  searchResults: SearchResult[];
  searching: boolean;
  railOpen: boolean;
  panelOpen: boolean;
  voiceActive: boolean;
  onMobileViewChange: (view: MobileView) => void;
  onSearchQueryChange: (query: string) => void;
  onOpenSearchResult: (result: SearchResult) => void;
  onToggleRail: () => void;
  onTogglePanel: () => void;
};

export default function AppTitleBar({
  isMobile,
  mobileView,
  activeProjectName,
  activeChatTitle,
  projectInfo,
  searchQuery,
  searchResults,
  searching,
  railOpen,
  panelOpen,
  voiceActive,
  onMobileViewChange,
  onSearchQueryChange,
  onOpenSearchResult,
  onToggleRail,
  onTogglePanel,
}: AppTitleBarProps) {
  if (isMobile) {
    return (
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface-1 px-3">
        <button
          onClick={() => onMobileViewChange(mobileView === "explorer" ? "chat" : "explorer")}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface-2 text-fg-muted",
            mobileView === "explorer" && "bg-surface-3 text-accent border-accent/30",
          )}
        >
          <Menu className="h-4.5 w-4.5" />
        </button>

        <div className="flex flex-col items-center min-w-0">
          <span className="text-[13px] font-semibold tracking-tight truncate max-w-[200px]">
            {mobileView === "explorer"
              ? "Workspace"
              : mobileView === "console"
                ? "Console"
                : activeProjectName}
          </span>
          {mobileView === "chat" && activeChatTitle && (
            <span className="text-[10px] text-fg-dim truncate max-w-[200px] leading-tight">
              {activeChatTitle}
            </span>
          )}
        </div>

        <button
          onClick={() => onMobileViewChange(mobileView === "console" ? "chat" : "console")}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface-2 text-fg-muted relative",
            mobileView === "console" && "bg-surface-3 text-accent border-accent/30",
          )}
        >
          <SquareTerminal className="h-4.5 w-4.5" />
          {voiceActive && (
            <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-accent" />
          )}
        </button>
      </header>
    );
  }

  return (
    <header className="flex h-11 shrink-0 items-center gap-4 border-b border-line bg-surface-1 px-3">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 text-accent">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <span className="text-[13px] font-semibold tracking-tight">Codex</span>
        <span className="mx-1 text-fg-dim">/</span>
        <button className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg">
          <Folder className="h-3.5 w-3.5 text-accent/80" />
          {activeProjectName}
        </button>
        {activeChatTitle && (
          <>
            <span className="text-fg-dim">/</span>
            <span className="px-1 text-[12.5px] text-fg truncate max-w-[240px]">
              {activeChatTitle}
            </span>
          </>
        )}
        {projectInfo?.is_git && projectInfo.branch && (
          <>
            <span className="text-fg-dim">/</span>
            <button className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-fg-muted hover:bg-surface-2 hover:text-accent">
              <GitBranch className="h-3 w-3" />
              {projectInfo.branch}
            </button>
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative">
          <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[11.5px] text-fg-muted">
            <Search className="h-3.5 w-3.5" />
            <input
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="Search chats"
              className="w-48 bg-transparent text-[11.5px] text-fg outline-none placeholder:text-fg-dim"
            />
          </div>
          {searchQuery.trim().length >= 2 && (
            <div className="absolute right-0 top-8 z-30 w-80 overflow-hidden rounded-md border border-line bg-surface-1 shadow-xl">
              <div className="border-b border-line-soft px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-fg-dim">
                {searching
                  ? "Searching"
                  : `${searchResults.length} result${searchResults.length === 1 ? "" : "s"}`}
              </div>
              <div className="max-h-80 overflow-y-auto py-1">
                {!searching && searchResults.length === 0 ? (
                  <div className="px-3 py-3 text-[12px] text-fg-dim">No matches found.</div>
                ) : (
                  searchResults.map((result) => (
                    <button
                      key={`${result.type}-${result.id}`}
                      onClick={() => onOpenSearchResult(result)}
                      className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-surface-2"
                    >
                      <span className="flex items-center gap-2 text-[12px] font-semibold text-fg">
                        <span className="rounded border border-line-soft px-1.5 py-0.5 font-mono text-[9px] uppercase text-fg-dim">
                          {result.type}
                        </span>
                        {result.title || "Result"}
                      </span>
                      <span className="max-h-9 overflow-hidden text-[11.5px] leading-relaxed text-fg-muted">
                        {result.snippet || "No preview available."}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        <button
          title={railOpen ? "Hide workspace sidebar" : "Show workspace sidebar"}
          aria-label={railOpen ? "Hide workspace sidebar" : "Show workspace sidebar"}
          aria-pressed={railOpen}
          onClick={onToggleRail}
          className={cn(
            "grid h-7 w-7 place-items-center rounded-md border transition-colors",
            railOpen
              ? "border-line bg-surface-3 text-fg"
              : "border-line bg-surface-2 text-fg-muted hover:text-fg hover:bg-surface-3",
          )}
        >
          {railOpen ? (
            <PanelLeftClose className="h-3.5 w-3.5" />
          ) : (
            <PanelLeftOpen className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          title={panelOpen ? "Hide console panel" : "Show console panel"}
          aria-label={panelOpen ? "Hide console panel" : "Show console panel"}
          aria-pressed={panelOpen}
          onClick={onTogglePanel}
          className={cn(
            "grid h-7 w-7 place-items-center rounded-md border transition-colors",
            panelOpen
              ? "border-line bg-surface-3 text-fg"
              : "border-line bg-surface-2 text-fg-muted hover:text-fg hover:bg-surface-3",
          )}
        >
          {panelOpen ? (
            <PanelRightClose className="h-3.5 w-3.5" />
          ) : (
            <PanelRightOpen className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </header>
  );
}
