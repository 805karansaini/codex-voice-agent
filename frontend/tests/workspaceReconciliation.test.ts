import assert from "node:assert/strict";
import test from "node:test";

import type { Chat, Project } from "../src/types.ts";
import {
  excludeDeletedChats,
  excludeDeletedProjects,
} from "../src/utils/workspaceReconciliation.ts";

const projects: Project[] = [
  { id: "project-a", name: "A", path: "/a", color: "#fff", createdAt: 2 },
  { id: "project-b", name: "B", path: "/b", color: "#fff", createdAt: 1 },
];
const chats: Chat[] = [
  { id: "chat-a", projectId: "project-a", title: "A", createdAt: 2 },
  { id: "chat-b", projectId: "project-b", title: "B", createdAt: 1 },
];

test("a project tombstone filters the project and every loaded child chat", () => {
  const projectDeletions = new Map([["project-a", "committed"]]);

  assert.deepEqual(
    excludeDeletedProjects(projects, projectDeletions).map((project) => project.id),
    ["project-b"],
  );
  assert.deepEqual(
    excludeDeletedChats(chats, new Map(), projectDeletions).map((chat) => chat.id),
    ["chat-b"],
  );
});

test("a chat tombstone filters only that chat", () => {
  const chatDeletions = new Map([["chat-a", "pending"]]);

  assert.deepEqual(
    excludeDeletedChats(chats, chatDeletions, new Map()).map((chat) => chat.id),
    ["chat-b"],
  );
});
