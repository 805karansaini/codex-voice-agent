import { useCallback, useRef } from "react";

import type { ActionPatch } from "./useConsoleSession";
import type { useProjectStore } from "./useProjectStore";
import type { ChatArtifact, CodexTimelineEvent, GeminiLiveUsage, Project } from "../types";
import { chatTitleFrom } from "../utils";
import { appendArtifacts } from "../utils/artifacts";
import { liveVoiceDeliveryFailureMessage } from "../utils/liveVoice";

type ProjectStore = ReturnType<typeof useProjectStore>;

type UseLiveVoiceSessionHandlersOptions = {
  store: ProjectStore;
  addAction: (action: {
    title: string;
    status: "running" | "done" | "failed";
    detail: string;
    streamingResponse?: string;
    workdir?: string;
  }) => string;
  updateAction: (id: string, patch: ActionPatch) => void;
  addHandoff: (name: string, summary: string) => void;
};

function appendCodexEvent(
  events: CodexTimelineEvent[] | undefined,
  event: CodexTimelineEvent,
): CodexTimelineEvent[] {
  const current = events || [];
  const key = `${event.method}:${event.item_id || ""}:${event.turn_id || ""}`;
  const existing = new Set(current.map((e) => `${e.method}:${e.item_id || ""}:${e.turn_id || ""}`));
  if (existing.has(key)) return current;
  return [...current, event].slice(-80);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function useLiveVoiceSessionHandlers({
  store,
  addAction,
  updateAction,
  addHandoff,
}: UseLiveVoiceSessionHandlersOptions) {
  const voiceCtxRef = useRef<{ project: Project; chatId: string } | null>(null);
  const activeVoiceActionIdRef = useRef<string | null>(null);
  const activeUserVoiceMsgIdRef = useRef<string | null>(null);
  const activeAssistantVoiceMsgIdRef = useRef<string | null>(null);

  const getWorkdir = useCallback(
    () => voiceCtxRef.current?.project.path ?? store.activeProject?.path,
    [store.activeProject],
  );
  const getProjectId = useCallback(
    () => voiceCtxRef.current?.project.id ?? store.activeProject?.id,
    [store.activeProject],
  );
  const getChatId = useCallback(
    () => voiceCtxRef.current?.chatId || store.activeChatId,
    [store.activeChatId],
  );

  const stopActiveVoiceHandoff = useCallback(
    (detail = "Stopped before completion.") => {
      if (!activeVoiceActionIdRef.current) return;
      updateAction(activeVoiceActionIdRef.current, {
        status: "failed",
        detail,
      });
      activeVoiceActionIdRef.current = null;
    },
    [updateAction],
  );

  const resetActiveVoiceMessages = useCallback(() => {
    activeUserVoiceMsgIdRef.current = null;
    activeAssistantVoiceMsgIdRef.current = null;
  }, []);

  const setVoiceContext = useCallback((project: Project, chatId: string) => {
    voiceCtxRef.current = { project, chatId };
  }, []);

  const clearVoiceContext = useCallback(() => {
    voiceCtxRef.current = null;
  }, []);

  const ensureVoiceContext = useCallback(() => {
    if (voiceCtxRef.current) return;
    voiceCtxRef.current =
      store.activeProject && store.activeChatId
        ? { project: store.activeProject, chatId: store.activeChatId }
        : null;
  }, [store.activeChatId, store.activeProject]);

  return {
    voiceCtxRef,
    getWorkdir,
    getProjectId,
    getChatId,
    stopActiveVoiceHandoff,
    resetActiveVoiceMessages,
    setVoiceContext,
    clearVoiceContext,
    ensureVoiceContext,
    liveVoiceHandlers: {
      onUserTranscript: (text: string) => {
        const ctx = voiceCtxRef.current;
        if (!ctx) return;
        if (!activeUserVoiceMsgIdRef.current) {
          const id = crypto.randomUUID();
          activeUserVoiceMsgIdRef.current = id;
          store.appendMessage(ctx.chatId, {
            id,
            role: "user",
            text,
            workdir: ctx.project.path,
          });
          if ((store.messagesByChat[ctx.chatId] || []).length === 0) {
            store.renameChat(ctx.project.id, ctx.chatId, chatTitleFrom(text || "Voice message"));
          }
        } else {
          store.updateMessage(ctx.chatId, activeUserVoiceMsgIdRef.current, (m) => ({
            ...m,
            text: m.text + text,
          }));
        }
      },
      onAssistantDelta: (text: string) => {
        const ctx = voiceCtxRef.current;
        if (!ctx) return;
        if (!activeAssistantVoiceMsgIdRef.current) {
          const id = crypto.randomUUID();
          activeAssistantVoiceMsgIdRef.current = id;
          store.appendMessage(ctx.chatId, {
            id,
            role: "assistant",
            text,
            streaming: true,
          });
        } else {
          store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
            ...m,
            text: m.text + text,
          }));
        }
      },
      onInterrupted: () => {
        const ctx = voiceCtxRef.current;
        if (!ctx) return;
        stopActiveVoiceHandoff("Interrupted before completion.");
        if (activeAssistantVoiceMsgIdRef.current) {
          store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
            ...m,
            streaming: false,
            text: m.text + " [Interrupted]",
          }));
        }
        resetActiveVoiceMessages();
      },
      onSessionRestarted: () => {
        const ctx = voiceCtxRef.current;
        if (!ctx) return;
        if (activeAssistantVoiceMsgIdRef.current) {
          store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
            ...m,
            streaming: false,
          }));
        }
        store.appendMessage(ctx.chatId, {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "Voice session restarted. Context is preserved up to your last completed turn.",
          workdir: ctx.project.path,
        });
        resetActiveVoiceMessages();
      },
      onTurnComplete: (
        userText: string,
        assistantText: string,
        usedCodex: boolean,
        workdir?: string,
        geminiLiveUsage?: GeminiLiveUsage,
      ) => {
        const ctx = voiceCtxRef.current;
        if (!ctx) return;
        const finalUserText = userText.trim();
        const finalAssistantText = assistantText.trim();
        if (activeUserVoiceMsgIdRef.current) {
          store.updateMessage(ctx.chatId, activeUserVoiceMsgIdRef.current, (m) => ({
            ...m,
            text: finalUserText || m.text,
          }));
        } else if (finalUserText) {
          store.appendMessage(ctx.chatId, {
            id: crypto.randomUUID(),
            role: "user",
            text: finalUserText,
            workdir: ctx.project.path,
          });
        }
        if (activeAssistantVoiceMsgIdRef.current) {
          store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
            ...m,
            text: finalAssistantText || m.text,
            streaming: false,
            usedCodex,
            workdir,
            geminiLiveUsage,
          }));
        } else if (finalAssistantText || usedCodex) {
          store.appendMessage(ctx.chatId, {
            id: crypto.randomUUID(),
            role: "assistant",
            text: finalAssistantText,
            usedCodex,
            workdir,
            geminiLiveUsage,
          });
        }
        resetActiveVoiceMessages();
      },
      onHandoffStart: (_name: string, task: string, workdir?: string) => {
        const ctx = voiceCtxRef.current;
        if (ctx && activeAssistantVoiceMsgIdRef.current) {
          store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
            ...m,
            usedCodex: true,
          }));
        }
        const id = addAction({
          title: "Voice handoff to Codex",
          status: "running",
          detail: task,
          streamingResponse: "",
          workdir: workdir || voiceCtxRef.current?.project.path,
        });
        activeVoiceActionIdRef.current = id;
      },
      onHandoffProgress: (_name: string, text: string) => {
        if (activeVoiceActionIdRef.current) {
          updateAction(activeVoiceActionIdRef.current, (prev) => ({
            streamingResponse: (prev.streamingResponse || "") + text,
          }));
        }
      },
      onHandoffFailed: (_name: string, message: string) => {
        if (activeVoiceActionIdRef.current) {
          updateAction(activeVoiceActionIdRef.current, {
            status: "failed",
            streamingResponse: message || "Handoff failed",
          });
          activeVoiceActionIdRef.current = null;
        }
      },
      onHandoffDeliveryFailed: (message: string) => {
        const ctx = voiceCtxRef.current;
        if (!ctx || !activeAssistantVoiceMsgIdRef.current) return;
        const displayMessage = liveVoiceDeliveryFailureMessage(message);
        store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
          ...m,
          streaming: false,
          text:
            m.text ||
            "Codex finished the local work. Gemini reconnected before reading the result, so the next voice session will include it.",
        }));
        addAction({
          title: "Gemini missed Codex result",
          status: "done",
          detail: displayMessage,
          streamingResponse: displayMessage,
          workdir: ctx.project.path,
        });
      },
      onHandoffTimeout: () => {
        const ctx = voiceCtxRef.current;
        if (!ctx || !activeAssistantVoiceMsgIdRef.current) return;
        store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
          ...m,
          streaming: false,
          text:
            m.text ||
            "Codex finished the local work. The full output is available below, but Gemini did not finish a final response.",
        }));
      },
      onCodexEvent: (event: unknown) => {
        const ctx = voiceCtxRef.current;
        if (!ctx || !event) return;
        const codexEvent = event as CodexTimelineEvent;
        if (
          activeVoiceActionIdRef.current &&
          codexEvent.method === "turn/completed" &&
          codexEvent.status === "completed"
        ) {
          updateAction(activeVoiceActionIdRef.current, {
            status: "done",
            workdir: ctx.project.path,
          });
          activeVoiceActionIdRef.current = null;
        }
        if (activeAssistantVoiceMsgIdRef.current) {
          store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
            ...m,
            usedCodex: true,
            codexEvents: appendCodexEvent(m.codexEvents, codexEvent),
            codexStatus: String(codexEvent.status || m.codexStatus || ""),
            codexTurnId: String(codexEvent.turn_id || m.codexTurnId || ""),
            codexThreadId: String(codexEvent.thread_id || m.codexThreadId || ""),
          }));
        }
      },
      onHandoff: (
        name: string,
        summary: string,
        workdir?: string,
        details?: Record<string, unknown>,
      ) => {
        addHandoff(name, summary);
        const ctx = voiceCtxRef.current;
        if (ctx) {
          const artifact = details?.artifact as ChatArtifact | undefined;
          const changeArtifact = details?.change_artifact as ChatArtifact | undefined;
          if (activeAssistantVoiceMsgIdRef.current) {
            store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
              ...m,
              usedCodex: true,
              codexEvents: (details?.codex_events || m.codexEvents || []) as CodexTimelineEvent[],
              codexStatus: stringValue(details?.codex_status, m.codexStatus),
              codexTurnId: stringValue(details?.codex_turn_id, m.codexTurnId),
              codexThreadId: stringValue(details?.codex_thread_id, m.codexThreadId),
              artifacts: appendArtifacts(m.artifacts, artifact, changeArtifact),
            }));
          } else {
            const id = crypto.randomUUID();
            activeAssistantVoiceMsgIdRef.current = id;
            store.appendMessage(ctx.chatId, {
              id,
              role: "assistant",
              text: "Codex finished the local work. The full output is available below while Gemini prepares the final response.",
              usedCodex: true,
              streaming: true,
              workdir,
              artifacts: appendArtifacts([], artifact, changeArtifact),
              codexEvents: (details?.codex_events || []) as CodexTimelineEvent[],
              codexStatus: stringValue(details?.codex_status),
              codexTurnId: stringValue(details?.codex_turn_id),
              codexThreadId: stringValue(details?.codex_thread_id),
            });
          }
        }
        if (activeVoiceActionIdRef.current) {
          updateAction(activeVoiceActionIdRef.current, {
            status: "done",
            workdir: workdir || voiceCtxRef.current?.project.path,
          });
          activeVoiceActionIdRef.current = null;
        } else {
          addAction({
            title: "Voice handoff to Codex",
            status: "done",
            detail: summary,
            streamingResponse: summary,
            workdir: workdir || voiceCtxRef.current?.project.path,
          });
        }
      },
    },
  };
}
