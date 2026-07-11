import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Project, ProjectFileEntry } from "../../types";
import * as api from "../../services/api";
import { cn, loadJSON, saveJSON } from "../../utils";

type ProjectFilesPanelProps = {
  project: Project | null | undefined;
  width: number;
  isMobile?: boolean;
  onOpenFile?: (path: string) => void;
};
type FileTree = { name: string; path: string; isDirectory: boolean; children: FileTree[] };
const EXPANDED_FOLDERS_KEY = "cva.fileTreeExpanded.v1";

function mergeFileEntries(
  current: ProjectFileEntry[],
  incoming: ProjectFileEntry[],
): ProjectFileEntry[] {
  const entries = new Map(current.map((entry) => [entry.path, entry]));
  incoming.forEach((entry) => entries.set(entry.path, entry));
  return [...entries.values()];
}

function fileIcon(path: string) {
  return /\.(md|mdx|txt)$/i.test(path) ? FileText : FileCode2;
}

function makeTree(entries: ProjectFileEntry[]): FileTree[] {
  const root: FileTree = { name: "", path: "", isDirectory: true, children: [] };
  const known = new Map([["", root]]);
  for (const entry of entries.sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = entry.path.split("/");
    let parent = root;
    let path = "";
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      path = path ? `${path}/${name}` : name;
      let node = known.get(path);
      if (!node) {
        node = {
          name,
          path,
          isDirectory: index < parts.length - 1 || entry.is_directory,
          children: [],
        };
        known.set(path, node);
        parent.children.push(node);
      }
      parent = node;
    }
  }
  const sortNodes = (nodes: FileTree[]) => {
    nodes.sort(
      (a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name),
    );
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(root.children);
  return root.children;
}

export default function ProjectFilesPanel({
  project,
  width,
  isMobile = false,
  onOpenFile,
}: ProjectFilesPanelProps) {
  const [entries, setEntries] = useState<ProjectFileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadedDirectories, setLoadedDirectories] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const restoredProjectRef = useRef("");
  const loadRequestRef = useRef(0);
  const tree = useMemo(() => makeTree(entries), [entries]);

  const loadFiles = useCallback(async () => {
    if (!project) return;
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const result = await api.fetchProjectFiles(project.id);
      if (requestId !== loadRequestRef.current) return;
      setEntries(result.entries);
      setTruncated(result.truncated);
      setLoadedDirectories(new Set([""]));
      const saved = loadJSON<Record<string, string[]>>(EXPANDED_FOLDERS_KEY, {})[project.id] || [];
      restoredProjectRef.current = project.id;
      setExpanded(new Set(saved));
      if (saved.length) {
        const children = await Promise.all(
          saved.map(async (folder) => (await api.fetchProjectFiles(project.id, folder)).entries),
        );
        if (requestId !== loadRequestRef.current) return;
        setEntries((current) => mergeFileEntries(current, children.flat()));
        setLoadedDirectories(new Set(["", ...saved]));
      }
    } catch (reason) {
      if (requestId !== loadRequestRef.current) return;
      setError(reason instanceof Error ? reason.message : "Could not load project files");
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    setEntries([]);
    setTruncated(false);
    setExpanded(new Set());
    setLoadedDirectories(new Set());
    restoredProjectRef.current = "";
    if (project) void loadFiles();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [loadFiles, project]);

  useEffect(() => {
    if (!project || restoredProjectRef.current !== project.id) return;
    const saved = loadJSON<Record<string, string[]>>(EXPANDED_FOLDERS_KEY, {});
    saveJSON(EXPANDED_FOLDERS_KEY, { ...saved, [project.id]: [...expanded] });
  }, [expanded, project]);

  const loadDirectory = async (path: string) => {
    if (!project || loadedDirectories.has(path)) return;
    const requestId = loadRequestRef.current;
    setLoading(true);
    try {
      const result = await api.fetchProjectFiles(project.id, path);
      if (requestId !== loadRequestRef.current) return;
      setEntries((current) => mergeFileEntries(current, result.entries));
      setLoadedDirectories((current) => new Set(current).add(path));
      setTruncated((current) => current || result.truncated);
    } catch (reason) {
      if (requestId !== loadRequestRef.current) return;
      setError(reason instanceof Error ? reason.message : "Could not load folder");
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  };

  const selectFile = (path: string) => {
    if (!project) return;
    if (onOpenFile) {
      onOpenFile(path);
      return;
    }
  };

  const toggleFolder = (path: string) => {
    const isOpening = !expanded.has(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (isOpening) void loadDirectory(path);
  };

  const collapseAll = () => setExpanded(new Set());

  const renderNode = (node: FileTree, depth: number): React.ReactNode => {
    if (node.isDirectory) {
      const isExpanded = expanded.has(node.path);
      return (
        <div key={node.path}>
          <button
            onClick={() => toggleFolder(node.path)}
            aria-expanded={isExpanded}
            className="flex w-full items-center gap-1 px-2 py-1 text-left text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg"
            style={{ paddingLeft: `${10 + depth * 14}px` }}
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            )}
            {isExpanded ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-fg-dim" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
          {isExpanded && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }
    const Icon = fileIcon(node.path);
    return (
      <button
        key={node.path}
        onClick={() => selectFile(node.path)}
        title={node.path}
        className="flex w-full items-center gap-2 py-1 text-left text-[12.5px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        style={{ paddingLeft: `${30 + depth * 14}px`, paddingRight: "8px" }}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-fg-dim" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  };

  if (!project)
    return (
      <aside
        style={{ width: isMobile ? "100%" : `${width}px` }}
        className="flex shrink-0 items-center justify-center bg-surface-1 p-6 text-center text-sm text-fg-dim"
      >
        Choose a project to browse its files.
      </aside>
    );

  return (
    <aside
      style={{ width: isMobile ? "100%" : `${width}px` }}
      className="flex min-h-0 shrink-0 flex-col bg-surface-1"
    >
      <div className="flex items-center justify-between border-b border-line-soft px-3 py-2.5">
        <div className="min-w-0">
          <p className="label">Project files</p>
          <p className="mt-0.5 truncate text-[11px] text-fg-dim" title={project.path}>
            {project.name}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            title="Collapse all folders"
            onClick={collapseAll}
            disabled={expanded.size === 0}
            className="rounded px-1.5 py-1 text-[10px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg disabled:cursor-default disabled:opacity-40"
          >
            Collapse all
          </button>
          <button
            title="Refresh files"
            onClick={() => void loadFiles()}
            className="grid h-7 w-7 place-items-center rounded text-fg-muted hover:bg-surface-2 hover:text-accent"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="Project files">
        {error && (
          <p className="m-3 rounded border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
            {error}
          </p>
        )}
        {!loading && tree.length === 0 && !error && (
          <p className="p-4 text-center text-[12.5px] text-fg-dim">No previewable files found.</p>
        )}
        {tree.map((node) => renderNode(node, 0))}
        {truncated && (
          <p className="px-3 py-2 text-[11px] text-fg-dim">
            Showing the first 500 items in a folder.
          </p>
        )}
      </div>
    </aside>
  );
}
