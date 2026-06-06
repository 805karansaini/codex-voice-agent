import React from "react";
import { FolderPlus, TerminalWindow } from "@phosphor-icons/react";
import { Project, Chat } from "../../types";
import ProjectCard from "./ProjectCard";
import ChatList from "./ChatList";
import ThemeToggle from "../common/ThemeToggle";

interface ProjectsRailProps {
  projects: Project[];
  activeId: string;
  chats: Record<string, Chat[]>;
  activeChatByProject: Record<string, string>;
  status: string;
  statusClass: "ready" | "warn" | "offline";
  theme: "dark" | "light";
  setTheme: (theme: "dark" | "light") => void;
  setActiveId: (id: string) => void;
  onNewProject: () => void;
  onRemoveProject: (id: string) => void;
  onSelectChat: (projectId: string, chatId: string) => void;
  onRenameChat: (projectId: string, chatId: string, title: string) => void;
  onRemoveChat: (projectId: string, chatId: string) => void;
  onCreateChat: (projectId: string) => void;
}

export const ProjectsRail: React.FC<ProjectsRailProps> = ({
  projects,
  activeId,
  chats,
  activeChatByProject,
  status,
  statusClass,
  theme,
  setTheme,
  setActiveId,
  onNewProject,
  onRemoveProject,
  onSelectChat,
  onRenameChat,
  onRemoveChat,
  onCreateChat,
}) => {
  const handleRemoveProject = (id: string, name: string) => {
    if (window.confirm(`Remove project “${name}”? This clears its chats and local history.`)) {
      onRemoveProject(id);
    }
  };

  return (
    <aside className="rail">
      <div className="railHead">
        <div className="brandMark">
          <TerminalWindow size={20} weight="fill" />
        </div>
        <div className="brandText">
          <p className="eyebrow">Local operator</p>
          <h1>Codex Voice</h1>
        </div>
      </div>

      <button className="newProject" type="button" onClick={onNewProject}>
        <FolderPlus size={17} weight="bold" /> New project
      </button>

      <div className="railLabel">
        <span>Projects</span>
        <em>{projects.length}</em>
      </div>

      {projects.length === 0 ? (
        <div className="railEmpty">
          <strong>No projects yet</strong>
          <span>Add a folder to start a workspace scoped to that directory.</span>
        </div>
      ) : (
        <div className="projectList">
          {projects.map((p) => {
            const isActive = p.id === activeId;
            const pChats = chats[p.id] || [];
            const pActiveChat = activeChatByProject[p.id] || "";

            return (
              <div
                className="projectGroup"
                key={p.id}
                style={{ ["--projColor" as string]: p.color }}
              >
                <ProjectCard
                  project={p}
                  isActive={isActive}
                  onClick={() => setActiveId(p.id)}
                  onRemove={handleRemoveProject}
                />

                {isActive && (
                  <ChatList
                    projectId={p.id}
                    chats={pChats}
                    activeChatId={pActiveChat}
                    onSelectChat={onSelectChat}
                    onRenameChat={onRenameChat}
                    onRemoveChat={onRemoveChat}
                    onCreateChat={onCreateChat}
                    projectColor={p.color}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="railFoot">
        <div className="railStatus">
          <span className={`statusDot ${statusClass}`} />
          <p>{status}</p>
        </div>
        <ThemeToggle theme={theme} onChange={setTheme} />
      </div>
    </aside>
  );
};
export default ProjectsRail;
