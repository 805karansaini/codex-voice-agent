import React from "react";
import { DotsThreeVertical } from "@phosphor-icons/react";
import { Project } from "../../types";

interface ProjectCardProps {
  project: Project;
  isActive: boolean;
  onClick: () => void;
  onRemove: (id: string, name: string) => void;
}

export function glyphFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  isActive,
  onClick,
  onRemove,
}) => {
  return (
    <button
      type="button"
      className={`projectCard ${isActive ? "active" : ""}`}
      onClick={onClick}
      style={{ ["--projColor" as string]: project.color }}
    >
      <span className="projectGlyph" style={{ background: project.color }}>
        {glyphFor(project.name)}
      </span>
      <span className="projectMeta">
        <span className="projectName">{project.name}</span>
        <span className="projectPath">{project.path}</span>
      </span>
      <span
        className="projectKebab"
        role="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(project.id, project.name);
        }}
        aria-label="Remove project"
      >
        <DotsThreeVertical size={16} weight="bold" />
      </span>
    </button>
  );
};
export default ProjectCard;
