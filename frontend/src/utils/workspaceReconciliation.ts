import type { Chat, Project } from "../types";

type IdLookup = Pick<ReadonlyMap<string, unknown>, "has">;

export function excludeDeletedProjects(
  projects: readonly Project[],
  projectDeletions: IdLookup,
): Project[] {
  return projects.filter((project) => !projectDeletions.has(project.id));
}

export function excludeDeletedChats(
  chats: readonly Chat[],
  chatDeletions: IdLookup,
  projectDeletions: IdLookup,
): Chat[] {
  return chats.filter(
    (chat) => !chatDeletions.has(chat.id) && !projectDeletions.has(chat.projectId),
  );
}
