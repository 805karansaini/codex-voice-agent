import type { ProjectFileEntry } from "../types";

export type FileTree = {
  name: string;
  path: string;
  isDirectory: boolean;
  children: FileTree[];
};

export function mergeFileEntries(
  current: ProjectFileEntry[],
  incoming: ProjectFileEntry[],
): ProjectFileEntry[] {
  const entries = new Map(current.map((entry) => [entry.path, entry]));
  incoming.forEach((entry) => entries.set(entry.path, entry));
  return [...entries.values()];
}

export function makeFileTree(entries: ProjectFileEntry[]): FileTree[] {
  const root: FileTree = { name: "", path: "", isDirectory: true, children: [] };
  const known = new Map<string, FileTree>([["", root]]);
  const sortedEntries = [...entries].sort((a, b) => a.path.localeCompare(b.path));

  for (const entry of sortedEntries) {
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
