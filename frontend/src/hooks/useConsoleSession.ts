import { useCallback, useEffect, useRef, useState } from "react";

import * as api from "../services/api";
import type { ActionEntry, ConsoleState } from "../types";
import { reconcileLoadedById } from "../utils/collections";
import {
  consoleStateForChat,
  updateConsoleAction,
  updateConsoleStateForChat,
  type ConsoleSessions,
} from "../utils/consoleSessions";

export type ActionPatch = Partial<ActionEntry> | ((prev: ActionEntry) => Partial<ActionEntry>);

export type ConsoleWriter = {
  isValid: () => boolean;
  addDebug: (message: string) => void;
  addHandoff: (name: string, summary: string) => void;
  addAction: (action: Omit<ActionEntry, "id">) => string;
  updateAction: (id: string, patch: ActionPatch) => void;
  clearConsoleState: () => void;
};

export type ConsoleDeletionLease = {
  token: symbol;
  chatIds: string[];
};

const SAVE_DELAY_MS = 250;

export function useConsoleSession(activeChatId: string | null) {
  const [sessions, setSessions] = useState<ConsoleSessions>({});
  const sessionsRef = useRef<ConsoleSessions>({});
  const revisionsRef = useRef<Record<string, number>>({});
  const savedRevisionsRef = useRef<Record<string, number>>({});
  const clearedRevisionsRef = useRef<Record<string, number>>({});
  const loadedChatsRef = useRef(new Set<string>());
  const failedHydrationsRef = useRef(new Set<string>());
  const hydrationTokensRef = useRef(new Map<string, symbol>());
  const saveTimersRef = useRef(new Map<string, number>());
  const saveChainsRef = useRef(new Map<string, Promise<void>>());
  const writerCacheRef = useRef(new Map<string, ConsoleWriter>());
  const actionChatsRef = useRef(new Map<string, string>());
  const deletingChatsRef = useRef(new Set<string>());
  const deletionTokensRef = useRef(new Map<string, symbol>());
  const disposedChatsRef = useRef(new Set<string>());

  const publishSessions = useCallback((next: ConsoleSessions) => {
    sessionsRef.current = next;
    setSessions(next);
  }, []);

  const enqueueSave = useCallback((chatId: string) => {
    if (disposedChatsRef.current.has(chatId) || deletingChatsRef.current.has(chatId)) return;
    const revision = revisionsRef.current[chatId] || 0;
    const snapshot = consoleStateForChat(sessionsRef.current, chatId);
    const previous = saveChainsRef.current.get(chatId) || Promise.resolve();
    const save = previous
      .catch(() => undefined)
      .then(async () => {
        if (disposedChatsRef.current.has(chatId) || deletingChatsRef.current.has(chatId)) return;
        await api.saveConsoleState(chatId, snapshot);
        if (disposedChatsRef.current.has(chatId)) return;
        savedRevisionsRef.current[chatId] = Math.max(
          savedRevisionsRef.current[chatId] || 0,
          revision,
        );
      });
    saveChainsRef.current.set(chatId, save);
    void save.then(
      () => {
        if (saveChainsRef.current.get(chatId) === save) saveChainsRef.current.delete(chatId);
      },
      () => {
        if (saveChainsRef.current.get(chatId) === save) saveChainsRef.current.delete(chatId);
      },
    );
  }, []);

  const scheduleSave = useCallback(
    (chatId: string) => {
      if (
        disposedChatsRef.current.has(chatId) ||
        deletingChatsRef.current.has(chatId) ||
        !loadedChatsRef.current.has(chatId)
      ) {
        return;
      }
      const existing = saveTimersRef.current.get(chatId);
      if (existing !== undefined) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        saveTimersRef.current.delete(chatId);
        if (disposedChatsRef.current.has(chatId) || deletingChatsRef.current.has(chatId)) return;
        enqueueSave(chatId);
      }, SAVE_DELAY_MS);
      saveTimersRef.current.set(chatId, timer);
    },
    [enqueueSave],
  );

  const updateChat = useCallback(
    (chatId: string, update: (current: ConsoleState) => ConsoleState, cleared = false) => {
      if (!chatId || disposedChatsRef.current.has(chatId)) return;
      const revision = (revisionsRef.current[chatId] || 0) + 1;
      revisionsRef.current[chatId] = revision;
      if (cleared) clearedRevisionsRef.current[chatId] = revision;
      const next = updateConsoleStateForChat(sessionsRef.current, chatId, update);
      publishSessions(next);
      if (failedHydrationsRef.current.has(chatId)) loadedChatsRef.current.add(chatId);
      scheduleSave(chatId);
    },
    [publishSessions, scheduleSave],
  );

  const forChat = useCallback(
    (chatId: string): ConsoleWriter => {
      const cached = writerCacheRef.current.get(chatId);
      if (cached) return cached;
      const writer: ConsoleWriter = {
        isValid: () => Boolean(chatId) && !disposedChatsRef.current.has(chatId),
        addDebug: (message) => {
          const time = new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
          updateChat(chatId, (current) => ({
            ...current,
            debugEntries: [
              { id: crypto.randomUUID(), time, message },
              ...current.debugEntries,
            ].slice(0, 40),
          }));
        },
        addHandoff: (name, summary) => {
          updateChat(chatId, (current) => ({
            ...current,
            handoffs: [{ id: crypto.randomUUID(), name, summary }, ...current.handoffs].slice(
              0,
              12,
            ),
          }));
        },
        addAction: (action) => {
          const id = crypto.randomUUID();
          if (disposedChatsRef.current.has(chatId)) return id;
          actionChatsRef.current.set(id, chatId);
          updateChat(chatId, (current) => {
            const actions = [{ id, ...action }, ...current.actions].slice(0, 16);
            const retainedActionIds = new Set(actions.map((item) => item.id));
            for (const previous of current.actions) {
              if (!retainedActionIds.has(previous.id)) actionChatsRef.current.delete(previous.id);
            }
            return { ...current, actions };
          });
          return id;
        },
        updateAction: (id, patch) => {
          updateChat(chatId, (current) => updateConsoleAction(current, id, patch));
        },
        clearConsoleState: () => {
          for (const action of consoleStateForChat(sessionsRef.current, chatId).actions) {
            actionChatsRef.current.delete(action.id);
          }
          updateChat(chatId, () => ({ actions: [], handoffs: [], debugEntries: [] }), true);
        },
      };
      writerCacheRef.current.set(chatId, writer);
      return writer;
    },
    [updateChat],
  );

  useEffect(() => {
    const chatId = activeChatId;
    if (!chatId || disposedChatsRef.current.has(chatId)) return;
    const token = Symbol(chatId);
    hydrationTokensRef.current.set(chatId, token);
    const startedRevision = revisionsRef.current[chatId] || 0;
    const savedRevisionAtStart = savedRevisionsRef.current[chatId] || 0;
    void api
      .fetchConsoleState(chatId)
      .then((remote) => {
        if (
          disposedChatsRef.current.has(chatId) ||
          hydrationTokensRef.current.get(chatId) !== token
        ) {
          return;
        }
        const currentRevision = revisionsRef.current[chatId] || 0;
        const local = consoleStateForChat(sessionsRef.current, chatId);
        const hasLocalChanges =
          currentRevision !== startedRevision || startedRevision > savedRevisionAtStart;
        const wasCleared = (clearedRevisionsRef.current[chatId] || 0) > savedRevisionAtStart;
        const reconciliation = { hasLocalChanges, wasCleared };
        const merged: ConsoleState = {
          actions: reconcileLoadedById(remote.actions || [], local.actions, reconciliation),
          handoffs: reconcileLoadedById(remote.handoffs || [], local.handoffs, reconciliation),
          debugEntries: reconcileLoadedById(
            remote.debugEntries || [],
            local.debugEntries,
            reconciliation,
          ),
        };
        for (const [actionId, actionChatId] of actionChatsRef.current) {
          if (actionChatId === chatId) actionChatsRef.current.delete(actionId);
        }
        for (const action of merged.actions) actionChatsRef.current.set(action.id, chatId);
        publishSessions(updateConsoleStateForChat(sessionsRef.current, chatId, () => merged));
        loadedChatsRef.current.add(chatId);
        failedHydrationsRef.current.delete(chatId);
        if (currentRevision > (savedRevisionsRef.current[chatId] || 0)) scheduleSave(chatId);
      })
      .catch(() => {
        if (
          disposedChatsRef.current.has(chatId) ||
          hydrationTokensRef.current.get(chatId) !== token
        ) {
          return;
        }
        failedHydrationsRef.current.add(chatId);
        if ((revisionsRef.current[chatId] || 0) > 0) {
          loadedChatsRef.current.add(chatId);
          scheduleSave(chatId);
        }
      });
  }, [activeChatId, publishSessions, scheduleSave]);

  useEffect(
    () => () => {
      for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer);
      saveTimersRef.current.clear();
      hydrationTokensRef.current.clear();
    },
    [],
  );

  const activeState = consoleStateForChat(sessions, activeChatId);
  const addDebug = useCallback(
    (message: string) => forChat(activeChatId || "").addDebug(message),
    [activeChatId, forChat],
  );
  const addHandoff = useCallback(
    (name: string, summary: string) => forChat(activeChatId || "").addHandoff(name, summary),
    [activeChatId, forChat],
  );
  const addAction = useCallback(
    (action: Omit<ActionEntry, "id">) => forChat(activeChatId || "").addAction(action),
    [activeChatId, forChat],
  );
  const updateAction = useCallback(
    (id: string, patch: ActionPatch) => {
      const chatId = actionChatsRef.current.get(id);
      if (!chatId) return;
      forChat(chatId).updateAction(id, patch);
    },
    [forChat],
  );
  const clearConsoleState = useCallback(
    () => forChat(activeChatId || "").clearConsoleState(),
    [activeChatId, forChat],
  );

  const beginConsoleDeletion = useCallback((chatIds: string[]): ConsoleDeletionLease => {
    const token = Symbol("console deletion");
    const uniqueChatIds = [...new Set(chatIds)].filter(
      (chatId) =>
        Boolean(chatId) &&
        !disposedChatsRef.current.has(chatId) &&
        !deletingChatsRef.current.has(chatId),
    );
    for (const chatId of uniqueChatIds) {
      deletingChatsRef.current.add(chatId);
      deletionTokensRef.current.set(chatId, token);
      const timer = saveTimersRef.current.get(chatId);
      if (timer !== undefined) window.clearTimeout(timer);
      saveTimersRef.current.delete(chatId);
    }
    return { token, chatIds: uniqueChatIds };
  }, []);

  const rollbackConsoleDeletion = useCallback(
    (lease: ConsoleDeletionLease): void => {
      for (const chatId of lease.chatIds) {
        if (deletionTokensRef.current.get(chatId) !== lease.token) continue;
        deletionTokensRef.current.delete(chatId);
        deletingChatsRef.current.delete(chatId);
        if ((revisionsRef.current[chatId] || 0) > (savedRevisionsRef.current[chatId] || 0)) {
          scheduleSave(chatId);
        }
      }
    },
    [scheduleSave],
  );

  const commitConsoleDeletion = useCallback(
    async (lease: ConsoleDeletionLease): Promise<void> => {
      const committedChatIds = lease.chatIds.filter(
        (chatId) => deletionTokensRef.current.get(chatId) === lease.token,
      );
      if (committedChatIds.length === 0) return;

      const next = { ...sessionsRef.current };
      for (const chatId of committedChatIds) {
        deletionTokensRef.current.delete(chatId);
        deletingChatsRef.current.delete(chatId);
        disposedChatsRef.current.add(chatId);
        hydrationTokensRef.current.delete(chatId);
        loadedChatsRef.current.delete(chatId);
        failedHydrationsRef.current.delete(chatId);
        writerCacheRef.current.delete(chatId);
        delete next[chatId];
        for (const [actionId, actionChatId] of actionChatsRef.current) {
          if (actionChatId === chatId) actionChatsRef.current.delete(actionId);
        }
      }
      publishSessions(next);

      await Promise.all(
        committedChatIds.map((chatId) =>
          (saveChainsRef.current.get(chatId) || Promise.resolve()).catch(() => undefined),
        ),
      );
      for (const chatId of committedChatIds) {
        saveChainsRef.current.delete(chatId);
        delete revisionsRef.current[chatId];
        delete savedRevisionsRef.current[chatId];
        delete clearedRevisionsRef.current[chatId];
      }

      // The chat/project deletion already clears this server-side. Repeating the
      // clear after any in-flight save settles guarantees that no older client
      // write can recreate orphaned console state.
      await Promise.all(
        committedChatIds.map((chatId) => api.deleteConsoleState(chatId).catch(() => undefined)),
      );
    },
    [publishSessions],
  );

  return {
    ...activeState,
    addDebug,
    addHandoff,
    addAction,
    updateAction,
    clearConsoleState,
    forChat,
    beginConsoleDeletion,
    rollbackConsoleDeletion,
    commitConsoleDeletion,
  };
}
