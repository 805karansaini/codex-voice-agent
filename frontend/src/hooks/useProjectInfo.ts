import { useEffect, useState } from "react";

import * as api from "../services/api";
import { Project, ProjectInfo } from "../types";

export function useProjectInfo(activeProject: Project | null) {
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);

  useEffect(() => {
    setProjectInfo(null);
    if (!activeProject) return;
    let cancelled = false;
    api
      .getProjectInfo(activeProject.path)
      .then((info) => {
        if (!cancelled) setProjectInfo(info);
      })
      .catch(() => {
        if (!cancelled) {
          setProjectInfo({
            path: activeProject.path,
            name: activeProject.name,
            exists: false,
            is_git: false,
            branch: null,
            file_count: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject]);

  return projectInfo;
}
