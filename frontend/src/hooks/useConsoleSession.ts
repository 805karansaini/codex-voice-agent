import { useCallback, useEffect, useRef, useState } from "react";

import * as api from "../services/api";
import { ActionEntry, DebugEntry, Handoff } from "../types";

export type ActionPatch = Partial<ActionEntry> | ((prev: ActionEntry) => Partial<ActionEntry>);

export function useConsoleSession(activeChatId: string | null) {
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [actions, setActions] = useState<ActionEntry[]>([]);
  const consoleLoadedChatRef = useRef("");
  const consoleSaveTimerRef = useRef<number | null>(null);

  const clearConsoleState = useCallback(() => {
    setActions([]);
    setHandoffs([]);
    setDebugEntries([]);
  }, []);

  useEffect(() => {
    const chatId = activeChatId;
    consoleLoadedChatRef.current = "";
    clearConsoleState();
    if (!chatId) return;
    let cancelled = false;
    api
      .fetchConsoleState(chatId)
      .then((state) => {
        if (cancelled) return;
        setActions(state.actions || []);
        setHandoffs(state.handoffs || []);
        setDebugEntries(state.debugEntries || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) consoleLoadedChatRef.current = chatId;
      });
    return () => {
      cancelled = true;
    };
  }, [activeChatId, clearConsoleState]);

  useEffect(() => {
    const chatId = activeChatId;
    if (!chatId || consoleLoadedChatRef.current !== chatId) return;
    if (consoleSaveTimerRef.current) window.clearTimeout(consoleSaveTimerRef.current);
    consoleSaveTimerRef.current = window.setTimeout(() => {
      // Console state is local operator telemetry; concurrent tabs may still
      // overwrite each other, but chat switching is guarded above.
      void api.saveConsoleState(chatId, { actions, handoffs, debugEntries }).catch(() => {});
    }, 250);
    return () => {
      if (consoleSaveTimerRef.current) window.clearTimeout(consoleSaveTimerRef.current);
    };
  }, [actions, handoffs, debugEntries, activeChatId]);

  const addDebug = useCallback((message: string) => {
    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setDebugEntries((current) =>
      [{ id: crypto.randomUUID(), time, message }, ...current].slice(0, 40),
    );
  }, []);

  const addHandoff = useCallback((name: string, summary: string) => {
    setHandoffs((current) => [{ id: crypto.randomUUID(), name, summary }, ...current].slice(0, 12));
  }, []);

  const addAction = useCallback((action: Omit<ActionEntry, "id">) => {
    const id = crypto.randomUUID();
    setActions((current) => [{ id, ...action }, ...current].slice(0, 16));
    return id;
  }, []);

  const updateAction = useCallback((id: string, patch: ActionPatch) => {
    setActions((current) =>
      current.map((action) => {
        if (action.id === id) {
          const resolvedPatch = typeof patch === "function" ? patch(action) : patch;
          return { ...action, ...resolvedPatch };
        }
        return action;
      }),
    );
  }, []);

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
