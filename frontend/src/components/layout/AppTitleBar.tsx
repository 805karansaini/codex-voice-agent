import {
  Folder,
  FileCode2,
  GitBranch,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Sparkles,
  SquareTerminal,
  X,
} from "lucide-react";
import { useState } from "react";

import type { MobileView } from "../../hooks/useAppLayout";
import type { ProjectInfo, SearchResult } from "../../types";
import { cn } from "../../utils";
import WorkspaceSearchBox from "./WorkspaceSearchBox";

export type AppTitleBarProps = {
  isMobile: boolean;
  mobileView: MobileView;
  activeProjectName: string;
  activeChatTitle?: string;
  projectInfo: ProjectInfo | null;
  searchQuery: string;
  searchResults: SearchResult[];
  searching: boolean;
  searchError: string;
  railOpen: boolean;
  panelOpen: boolean;
  filePanelOpen: boolean;
  voiceActive: boolean;
  onMobileViewChange: (view: MobileView) => void;
  onSearchQueryChange: (query: string) => void;
  onOpenSearchResult: (result: SearchResult) => void;
  onToggleRail: () => void;
  onTogglePanel: () => void;
  onToggleFilePanel: () => void;
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
  searchError,
  railOpen,
  panelOpen,
  filePanelOpen,
  voiceActive,
  onMobileViewChange,
  onSearchQueryChange,
  onOpenSearchResult,
  onToggleRail,
  onTogglePanel,
  onToggleFilePanel,
}: AppTitleBarProps) {
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  if (isMobile) {
    return (
      <header className="relative z-50 flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface-1 px-3 shadow-sm">
        <button
          onClick={() =>
            onMobileViewChange(
              mobileView === "explorer" || mobileView === "files" ? "chat" : "explorer",
            )
          }
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface-2 text-fg-muted transition-colors",
            (mobileView === "explorer" || mobileView === "files") &&
              "bg-surface-3 text-accent border-accent/30",
          )}
          aria-label={
            mobileView === "explorer" || mobileView === "files"
              ? "Return to chat"
              : "Open workspace"
          }
        >
          <Menu className="h-4.5 w-4.5" />
        </button>

        <div className="flex flex-col items-center min-w-0">
          <span className="max-w-[220px] truncate text-[13.5px] font-semibold tracking-tight">
            {mobileView === "explorer"
              ? "Workspace"
              : mobileView === "files"
                ? "Files"
                : mobileView === "console"
                  ? "Console"
                  : activeProjectName}
          </span>
          {mobileView === "chat" && activeChatTitle && (
            <span className="max-w-[220px] truncate text-[10.5px] leading-tight text-fg-muted">
              {activeChatTitle}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setMobileSearchOpen((open) => !open)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface-2 text-fg-muted"
            aria-label={mobileSearchOpen ? "Close search" : "Search chats"}
            aria-expanded={mobileSearchOpen}
          >
            {mobileSearchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
          </button>
          <button
            onClick={() => onMobileViewChange(mobileView === "console" ? "chat" : "console")}
            className={cn(
              "relative flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface-2 text-fg-muted transition-colors",
              mobileView === "console" && "bg-surface-3 text-accent border-accent/30",
            )}
            aria-label={mobileView === "console" ? "Return to chat" : "Open console"}
          >
            <SquareTerminal className="h-4.5 w-4.5" />
            {voiceActive && (
              <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-accent" />
            )}
          </button>
        </div>
        {mobileSearchOpen && (
          <div className="absolute inset-x-2 top-[calc(100%+6px)] z-40">
            <WorkspaceSearchBox
              mobile
              searchQuery={searchQuery}
              searchResults={searchResults}
              searching={searching}
              searchError={searchError}
              onSearchQueryChange={onSearchQueryChange}
              onOpenSearchResult={onOpenSearchResult}
              onDismiss={() => setMobileSearchOpen(false)}
            />
          </div>
        )}
      </header>
    );
  }

  return (
    <header className="relative z-50 flex h-13 shrink-0 items-center gap-4 border-b border-line bg-surface-1 px-3.5 shadow-sm">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-accent/25 bg-accent/15 text-accent shadow-sm">
          <Sparkles className="h-4 w-4" />
        </div>
        <span className="text-[14px] font-semibold tracking-[-0.02em]">Vodex</span>
        <span className="mx-1 text-fg-dim">/</span>
        <span className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-fg-muted">
          <Folder className="h-3.5 w-3.5 text-accent/80" />
          {activeProjectName}
        </span>
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
            <span className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 font-mono text-[10.5px] text-fg-muted">
              <GitBranch className="h-3 w-3" />
              {projectInfo.branch}
            </span>
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <WorkspaceSearchBox
          searchQuery={searchQuery}
          searchResults={searchResults}
          searching={searching}
          searchError={searchError}
          onSearchQueryChange={onSearchQueryChange}
          onOpenSearchResult={onOpenSearchResult}
        />
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
          title={filePanelOpen ? "Hide files" : "Show files"}
          aria-label={filePanelOpen ? "Hide files" : "Show files"}
          aria-pressed={filePanelOpen}
          onClick={onToggleFilePanel}
          className={cn(
            "grid h-7 w-7 place-items-center rounded-md border transition-colors",
            filePanelOpen
              ? "border-line bg-surface-3 text-accent"
              : "border-line bg-surface-2 text-fg-muted hover:text-fg hover:bg-surface-3",
          )}
        >
          <FileCode2 className="h-3.5 w-3.5" />
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
