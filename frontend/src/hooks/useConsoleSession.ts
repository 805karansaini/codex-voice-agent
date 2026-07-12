import { useCallback, useEffect, useRef, useState } from "react";

import * as api from "../services/api";
import { ActionEntry, DebugEntry, Handoff } from "../types";
import { reconcileLoadedById } from "../utils/collections";

export type ActionPatch = Partial<ActionEntry> | ((prev: ActionEntry) => Partial<ActionEntry>);

export function useConsoleSession(activeChatId: string | null) {
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [actions, setActions] = useState<ActionEntry[]>([]);
  const [loadedChatId, setLoadedChatId] = useState("");
  const consoleSaveTimerRef = useRef<number | null>(null);
  const consoleChangedWhileLoadingRef = useRef(false);
  const consoleClearedWhileLoadingRef = useRef(false);
  const failedHydrationChatRef = useRef("");

  const markConsoleChanged = useCallback(() => {
    consoleChangedWhileLoadingRef.current = true;
    if (activeChatId && failedHydrationChatRef.current === activeChatId) {
      setLoadedChatId(activeChatId);
    }
  }, [activeChatId]);

  const clearConsoleState = useCallback(() => {
    markConsoleChanged();
    consoleClearedWhileLoadingRef.current = true;
    setActions([]);
    setHandoffs([]);
    setDebugEntries([]);
  }, [markConsoleChanged]);

  useEffect(() => {
    const chatId = activeChatId;
    setLoadedChatId("");
    failedHydrationChatRef.current = "";
    consoleChangedWhileLoadingRef.current = false;
    consoleClearedWhileLoadingRef.current = false;
    setActions([]);
    setHandoffs([]);
    setDebugEntries([]);
    if (!chatId) return;
    let cancelled = false;
    api
      .fetchConsoleState(chatId)
      .then((state) => {
        if (cancelled) return;
        const reconciliation = {
          hasLocalChanges: consoleChangedWhileLoadingRef.current,
          wasCleared: consoleClearedWhileLoadingRef.current,
        };
        setActions((current) => reconcileLoadedById(state.actions || [], current, reconciliation));
        setHandoffs((current) =>
          reconcileLoadedById(state.handoffs || [], current, reconciliation),
        );
        setDebugEntries((current) =>
          reconcileLoadedById(state.debugEntries || [], current, reconciliation),
        );
        setLoadedChatId(chatId);
      })
      .catch(() => {
        if (cancelled) return;
        failedHydrationChatRef.current = chatId;
        if (consoleChangedWhileLoadingRef.current) setLoadedChatId(chatId);
      });
    return () => {
      cancelled = true;
    };
  }, [activeChatId]);

  useEffect(() => {
    const chatId = activeChatId;
    if (!chatId || loadedChatId !== chatId) return;
    if (consoleSaveTimerRef.current !== null) window.clearTimeout(consoleSaveTimerRef.current);
    consoleSaveTimerRef.current = window.setTimeout(() => {
      consoleSaveTimerRef.current = null;
      // Console state is local operator telemetry; concurrent tabs may still
      // overwrite each other, but chat switching is guarded above.
      void api.saveConsoleState(chatId, { actions, handoffs, debugEntries }).catch(() => {});
    }, 250);
    return () => {
      if (consoleSaveTimerRef.current !== null) {
        window.clearTimeout(consoleSaveTimerRef.current);
        consoleSaveTimerRef.current = null;
      }
    };
  }, [actions, handoffs, debugEntries, activeChatId, loadedChatId]);

  const addDebug = useCallback(
    (message: string) => {
      markConsoleChanged();
      const time = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      setDebugEntries((current) =>
        [{ id: crypto.randomUUID(), time, message }, ...current].slice(0, 40),
      );
    },
    [markConsoleChanged],
  );

  const addHandoff = useCallback(
    (name: string, summary: string) => {
      markConsoleChanged();
      setHandoffs((current) =>
        [{ id: crypto.randomUUID(), name, summary }, ...current].slice(0, 12),
      );
    },
    [markConsoleChanged],
  );

  const addAction = useCallback(
    (action: Omit<ActionEntry, "id">) => {
      markConsoleChanged();
      const id = crypto.randomUUID();
      setActions((current) => [{ id, ...action }, ...current].slice(0, 16));
      return id;
    },
    [markConsoleChanged],
  );

  const updateAction = useCallback(
    (id: string, patch: ActionPatch) => {
      markConsoleChanged();
      setActions((current) =>
        current.map((action) => {
          if (action.id === id) {
            const resolvedPatch = typeof patch === "function" ? patch(action) : patch;
            return { ...action, ...resolvedPatch };
          }
          return action;
        }),
      );
    },
    [markConsoleChanged],
  );

  return {
    debugEntries,
    handoffs,
    actions,
    addDebug,
    addHandoff,
    addAction,
    updateAction,
    clearConsoleState,
  };
}
