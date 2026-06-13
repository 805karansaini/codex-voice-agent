import { useCallback, useState } from "react";

export function useWorkspaceSidebarState() {
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [visibleChatsCount, setVisibleChatsCount] = useState<Record<string, number>>({});

  const toggleProjectExpanded = useCallback((projectId: string, expanded: boolean) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [projectId]: !expanded,
    }));
  }, []);

  const markProjectExpanded = useCallback((projectId: string) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [projectId]: true,
    }));
  }, []);

  const showMoreChats = useCallback((projectId: string) => {
    setVisibleChatsCount((prev) => ({
      ...prev,
      [projectId]: (prev[projectId] || 5) + 5,
    }));
  }, []);

  return {
    expandedProjects,
    visibleChatsCount,
    toggleProjectExpanded,
    markProjectExpanded,
    showMoreChats,
  };
}
