import {
  Activity,
  Cable,
  ChevronRight,
  FileCode2,
  FolderPlus,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  SquareTerminal,
  Sun,
  Trash2,
} from "lucide-react";
import type { KeyboardEvent } from "react";

import type { Chat, Project } from "../../types";
import { cn } from "../../utils";

type WorkspaceSidebarProps = {
  isMobile: boolean;
  width: number;
  projects: Project[];
  chats: Record<string, Chat[]>;
  activeProjectId: string | null;
  activeChatByProject: Record<string, string>;
  expandedProjects: Record<string, boolean>;
  visibleChatsCount: Record<string, number>;
  theme: "dark" | "light";
  activeView: "chats" | "files";
  onAddProject: () => void;
  onToggleProject: (projectId: string, expanded: boolean) => void;
  onCreateChat: (projectId: string) => void;
  onRemoveProject: (projectId: string, name: string) => void;
  onSelectChat: (projectId: string, chatId: string) => void;
  onRenameChat: (projectId: string, chatId: string, title: string) => void;
  onRemoveChat: (projectId: string, chatId: string) => void;
  onShowMoreChats: (projectId: string) => void;
  onToggleTheme: () => void;
  onOpenVoiceSettings: () => void;
  onViewChange: (view: "chats" | "files") => void;
  onChatKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

function chatLimitFor(
  projectId: string,
  chats: Chat[],
  activeChatId: string,
  visibleChatsCount: Record<string, number>,
): number {
  const userLimit = visibleChatsCount[projectId] || 5;
  if (!activeChatId) return userLimit;
  const activeIndex = chats.findIndex((chat) => chat.id === activeChatId);
  if (activeIndex === -1) return userLimit;
  if (activeIndex >= userLimit) {
    return Math.ceil((activeIndex + 1) / 5) * 5;
  }
  return userLimit;
}

export default function WorkspaceSidebar({
  isMobile,
  width,
  projects,
  chats,
  activeProjectId,
  activeChatByProject,
  expandedProjects,
  visibleChatsCount,
  theme,
  activeView,
  onAddProject,
  onToggleProject,
  onCreateChat,
  onRemoveProject,
  onSelectChat,
  onRenameChat,
  onRemoveChat,
  onShowMoreChats,
  onToggleTheme,
  onOpenVoiceSettings,
  onViewChange,
  onChatKeyDown,
}: WorkspaceSidebarProps) {
  return (
    <aside
      style={isMobile ? { width: "100%" } : { width: `${width}px` }}
      className={cn(
        "flex h-full min-h-0 flex-col bg-surface-1 shrink-0",
        !isMobile ? "border-r border-line" : "w-full",
      )}
    >
      <div className="flex items-center justify-between border-b border-line-soft px-3 py-2.5 shrink-0">
        <span className="label">Workspace</span>
        <button
          title="Add Project"
          onClick={onAddProject}
          className="grid h-6 w-6 place-items-center rounded text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-1" aria-label="Workspace chats">
        {projects.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-[12.5px] text-fg-dim">No projects yet.</p>
            <button
              onClick={onAddProject}
              className="mt-2 text-[12px] text-accent hover:underline flex items-center gap-1 mx-auto"
            >
              <Plus className="h-3 w-3" /> Add folder
            </button>
          </div>
        ) : (
          projects.map((project) => {
            const isActive = project.id === activeProjectId;
            const isExpanded =
              expandedProjects[project.id] !== undefined ? expandedProjects[project.id] : isActive;
            const projectChats = chats[project.id] || [];
            const activeChatId = activeChatByProject[project.id] || "";
            const chatLimit = chatLimitFor(
              project.id,
              projectChats,
              activeChatId,
              visibleChatsCount,
            );
            const visibleChats = projectChats.slice(0, chatLimit);

            return (
              <div key={project.id} className="px-1">
                <div
                  className={cn(
                    "group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors",
                    isActive
                      ? "bg-surface-2 text-fg"
                      : "text-fg-muted hover:bg-surface-2/60 hover:text-fg",
                  )}
                >
                  <button
                    onClick={() => onToggleProject(project.id, isExpanded)}
                    className="flex items-center gap-1.5 flex-1 min-w-0"
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 text-fg-dim transition-transform shrink-0",
                        isExpanded && "rotate-90",
                      )}
                    />
                    <span
                      className="h-2 w-2 rounded-sm shrink-0"
                      style={{ background: project.color }}
                    />
                    <span className="truncate text-[13px] font-medium">{project.name}</span>
                  </button>

                  <button
                    title="New chat"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCreateChat(project.id);
                    }}
                    className={cn(
                      "p-0.5 rounded hover:bg-surface-3 hover:text-accent text-fg-dim transition-all shrink-0",
                      isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>

                  <button
                    title="Remove Project"
                    onClick={() => onRemoveProject(project.id, project.name)}
                    className={cn(
                      "p-0.5 rounded hover:bg-surface-3 hover:text-danger text-fg-dim transition-all shrink-0",
                      isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>

                {isExpanded && (
                  <div className="ml-5 mt-0.5 mb-1 border-l border-line-soft pl-2">
                    {visibleChats.map((chat) => {
                      const isChatActive = chat.id === activeChatId;
                      return (
                        <div
                          key={chat.id}
                          className={cn(
                            "group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12.5px] transition-colors",
                            isChatActive
                              ? "bg-accent/10 text-fg"
                              : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                          )}
                        >
                          <button
                            data-chat-switcher
                            aria-current={isChatActive ? "page" : undefined}
                            onClick={() => onSelectChat(project.id, chat.id)}
                            onKeyDown={onChatKeyDown}
                            className="flex items-center gap-1.5 flex-1 min-w-0"
                            title={chat.title}
                          >
                            <span className="truncate">{chat.title}</span>
                          </button>

                          <button
                            title="Rename chat"
                            onClick={() => onRenameChat(project.id, chat.id, chat.title)}
                            className={cn(
                              "p-0.5 rounded hover:bg-surface-3 hover:text-fg text-fg-dim transition-all shrink-0",
                              isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                            )}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            title="Delete chat"
                            onClick={() => onRemoveChat(project.id, chat.id)}
                            className={cn(
                              "p-0.5 rounded hover:bg-surface-3 hover:text-danger text-fg-dim transition-all shrink-0",
                              isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                            )}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                    {projectChats.length > chatLimit && (
                      <button
                        onClick={() => onShowMoreChats(project.id)}
                        className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-fg-dim hover:bg-surface-2 hover:text-accent font-medium border border-dashed border-line-soft/60"
                        title="Show more chats"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </nav>

      {isMobile && (
        <div className="border-t border-line bg-surface-2 shrink-0">
          <nav
            className="grid grid-cols-4 gap-1 border-b border-line-soft px-3 py-2"
            aria-label="Workspace views"
          >
            <button
              onClick={() => onViewChange("chats")}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] font-medium",
                activeView === "chats"
                  ? "bg-accent/10 text-accent"
                  : "text-fg-dim hover:bg-surface-3 hover:text-fg",
              )}
            >
              <SquareTerminal className="h-4 w-4" />
              Chats
            </button>
            <button
              onClick={() => onViewChange("files")}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] font-medium",
                activeView === "files"
                  ? "bg-accent/10 text-accent"
                  : "text-fg-dim hover:bg-surface-3 hover:text-fg",
              )}
            >
              <FileCode2 className="h-4 w-4" />
              Files
            </button>
            <button
              disabled
              className="flex flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] text-fg-dim opacity-40"
            >
              <Activity className="h-4 w-4" />
              Runs
            </button>
            <button
              disabled
              className="flex flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] text-fg-dim opacity-40"
            >
              <Cable className="h-4 w-4" />
              MCP
            </button>
          </nav>
          <div className="flex items-center justify-between gap-3 p-3">
            <button
              onClick={onToggleTheme}
              className="flex flex-1 items-center justify-center gap-2 rounded-md border border-line bg-surface-1 px-3 py-1.5 text-xs text-fg-muted hover:bg-surface-3 hover:text-fg"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
            </button>

            <button
              onClick={onOpenVoiceSettings}
              className="flex flex-1 items-center justify-center gap-2 rounded-md border border-line bg-surface-1 px-3 py-1.5 text-xs text-fg-muted hover:bg-surface-3 hover:text-fg"
            >
              <Settings className="h-4 w-4" />
              <span>Voice Settings</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
