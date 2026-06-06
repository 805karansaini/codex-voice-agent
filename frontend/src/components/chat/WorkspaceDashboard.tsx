import React from "react";
import { GitBranch, ChatText, Plugs } from "@phosphor-icons/react";
import { Project, ProjectInfo } from "../../types";
import { glyphFor } from "../sidebar/ProjectCard";

interface WorkspaceDashboardProps {
  project: Project | null;
  projectInfo: ProjectInfo | null;
  messagesCount: number;
}

export const WorkspaceDashboard: React.FC<WorkspaceDashboardProps> = ({
  project,
  projectInfo,
  messagesCount,
}) => {
  if (!project) {
    return (
      <div className="workspaceDashboard empty">
        <span>Select or create a project to begin</span>
      </div>
    );
  }

  const hasMissingFolder = projectInfo && !projectInfo.exists;

  return (
    <div className="workspaceDashboard">
      <span className="dbProject">
        <span className="dbProjectGlyph" style={{ background: project.color }}>
          {glyphFor(project.name)}
        </span>
        <span className="dbProjectName">{project.name}</span>
      </span>
      <span className="dbDivider">/</span>
      
      <span 
        className="dbPill dbBranch" 
        title={`Git Branch: ${projectInfo?.branch || "No branch"}`}
      >
        <GitBranch size={13} weight="bold" />
        <span>{projectInfo?.branch || (projectInfo?.is_git ? "detached" : "no git")}</span>
      </span>

      {hasMissingFolder && (
        <span className="dbPill dbDanger" title="Directory is missing from filesystem!">
          <Plugs size={13} weight="bold" />
          <span>Missing</span>
        </span>
      )}

      <span className="dbPill dbMessages" title={`${messagesCount} messages in chat`}>
        <ChatText size={13} weight="bold" />
        <span>{messagesCount} msgs</span>
      </span>
    </div>
  );
};
export default WorkspaceDashboard;
