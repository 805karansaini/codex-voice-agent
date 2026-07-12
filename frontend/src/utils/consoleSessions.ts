import type { ActionEntry, ConsoleState } from "../types";

export type ConsoleSessions = Record<string, ConsoleState>;

const EMPTY_CONSOLE_STATE: ConsoleState = {
  actions: [],
  handoffs: [],
  debugEntries: [],
};

export function consoleStateForChat(
  sessions: ConsoleSessions,
  chatId: string | null | undefined,
): ConsoleState {
  return chatId ? sessions[chatId] || EMPTY_CONSOLE_STATE : EMPTY_CONSOLE_STATE;
}

export function updateConsoleStateForChat(
  sessions: ConsoleSessions,
  chatId: string,
  update: (current: ConsoleState) => ConsoleState,
): ConsoleSessions {
  if (!chatId) return sessions;
  return {
    ...sessions,
    [chatId]: update(consoleStateForChat(sessions, chatId)),
  };
}

export function updateConsoleAction(
  state: ConsoleState,
  id: string,
  patch: Partial<ActionEntry> | ((previous: ActionEntry) => Partial<ActionEntry>),
): ConsoleState {
  return {
    ...state,
    actions: state.actions.map((action) => {
      if (action.id !== id) return action;
      const resolvedPatch = typeof patch === "function" ? patch(action) : patch;
      return { ...action, ...resolvedPatch };
    }),
  };
}
