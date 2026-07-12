import { useCallback, useRef, useState } from "react";

import { watchCodexJob } from "../services/codexJobs";
import type { ActionPatch } from "./useConsoleSession";
import type { useProjectStore } from "./useProjectStore";
import type { ChatArtifact, CodexTimelineEvent, GeminiLiveUsage, Project } from "../types";
import type { ServerEvent } from "../types/protocol";
import { chatTitleFrom } from "../utils";
import { appendArtifacts } from "../utils/artifacts";
import { appendCodexEvent } from "../utils/codexEvents";
import { liveVoiceStartDeliveryFailureMessage } from "../utils/liveVoice";

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
  onBackgroundJobSettled?: () => void;
};

export type ActiveCodexJobStatus = {
  jobId: string;
  chatId: string;
  status: "queued" | "running" | "done" | "failed";
  task: string;
  message: string;
  startedAt: number;
  workdir?: string;
};

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function useLiveVoiceSessionHandlers({
  store,
  addAction,
  updateAction,
  addHandoff,
  onBackgroundJobSettled,
}: UseLiveVoiceSessionHandlersOptions) {
  const voiceCtxRef = useRef<{ project: Project; chatId: string } | null>(null);
  const activeVoiceActionIdRef = useRef<string | null>(null);
  const activeUserVoiceMsgIdRef = useRef<string | null>(null);
  const activeAssistantVoiceMsgIdRef = useRef<string | null>(null);
  const activeCodexMsgIdRef = useRef<string | null>(null);
  const activeVoiceJobIdRef = useRef<string | null>(null);
  const [voiceContext, setVoiceContextState] = useState<{
    project: Project;
    chatId: string;
  } | null>(null);
  const [activeCodexJob, setActiveCodexJob] = useState<ActiveCodexJobStatus | null>(null);

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
      if (activeVoiceJobIdRef.current) {
        updateAction(activeVoiceActionIdRef.current, {
          status: "running",
          detail: "Voice session closed. Codex is still running.",
        });
        return;
      }
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
    const context = { project, chatId };
    voiceCtxRef.current = context;
    setVoiceContextState(context);
  }, []);

  const clearVoiceContext = useCallback(() => {
    voiceCtxRef.current = null;
    setVoiceContextState(null);
  }, []);

  const ensureVoiceContext = useCallback(() => {
    if (voiceCtxRef.current) return;
    const context =
      store.activeProject && store.activeChatId
        ? { project: store.activeProject, chatId: store.activeChatId }
        : null;
    voiceCtxRef.current = context;
    setVoiceContextState(context);
  }, [store.activeChatId, store.activeProject]);

  return {
    voiceContext,
    getWorkdir,
    getProjectId,
    getChatId,
    stopActiveVoiceHandoff,
    resetActiveVoiceMessages,
    setVoiceContext,
    clearVoiceContext,
    ensureVoiceContext,
    activeCodexJob,
    liveVoiceHandlers: {
      onUserTranscript: (text: string) => {
        const ctx = voiceCtxRef.current;
        if (!ctx) return;
        if (!activeUserVoiceMsgIdRef.current) {
          const id = crypto.randomUUID();
          activeUserVoiceMsgIdRef.current = id;
          store.insertMessage(
            ctx.chatId,
            {
              id,
              role: "user",
              text,
              workdir: ctx.project.path,
            },
            activeAssistantVoiceMsgIdRef.current,
          );
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
        if (!ctx) return;
        let codexMessageId = activeAssistantVoiceMsgIdRef.current;
        if (!codexMessageId) {
          codexMessageId = crypto.randomUUID();
          activeAssistantVoiceMsgIdRef.current = codexMessageId;
          store.appendMessage(ctx.chatId, {
            id: codexMessageId,
            role: "assistant",
            text: task || "Codex is starting the local work.",
            usedCodex: true,
            streaming: true,
            workdir: workdir || ctx.project.path,
            codexStatus: "running",
          });
        }
        activeCodexMsgIdRef.current = codexMessageId;
        if (ctx && activeAssistantVoiceMsgIdRef.current) {
          store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
            ...m,
            usedCodex: true,
            streaming: true,
            codexStatus: m.codexStatus || "running",
            workdir: workdir || m.workdir,
          }));
        }
        const id = addAction({
          title: "Vodex handoff to Codex",
          status: "running",
          detail: task,
          streamingResponse: "",
          workdir: workdir || voiceCtxRef.current?.project.path,
        });
        activeVoiceActionIdRef.current = id;
        activeVoiceJobIdRef.current = null;
        setActiveCodexJob({
          jobId: "",
          chatId: ctx.chatId,
          status: "running",
          task: task || "Codex is starting the local work.",
          message: task || "Codex is starting the local work.",
          startedAt: Date.now(),
          workdir: workdir || ctx.project.path,
        });
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
          activeVoiceJobIdRef.current = null;
          activeCodexMsgIdRef.current = null;
          setActiveCodexJob(null);
        }
      },
      onHandoffStartDeliveryFailed: (message: string) => {
        const ctx = voiceCtxRef.current;
        if (!ctx || !activeAssistantVoiceMsgIdRef.current) return;
        const displayMessage = liveVoiceStartDeliveryFailureMessage(message);
        store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
          ...m,
          streaming: true,
          text: m.text || "Codex is running this task in the background.",
        }));
        if (activeVoiceActionIdRef.current) {
          updateAction(activeVoiceActionIdRef.current, {
            status: "running",
            streamingResponse: displayMessage,
            workdir: ctx.project.path,
          });
        }
      },
      onHandoffTimeout: () => {
        const ctx = voiceCtxRef.current;
        if (!ctx || !activeAssistantVoiceMsgIdRef.current) return;
        store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
          ...m,
          streaming: false,
          text:
            m.text ||
            "Codex finished the local work. The full output is available below, but Vodex did not finish a final response.",
        }));
      },
      onCodexEvent: (codexEvent: CodexTimelineEvent) => {
        const ctx = voiceCtxRef.current;
        if (!ctx) return;
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
      onHandoff: (name: string, summary: string, workdir?: string, details?: ServerEvent) => {
        addHandoff(name, summary);
        const ctx = voiceCtxRef.current;
        const backgroundJobId =
          typeof details?.background_job_id === "string" ? details.background_job_id : "";
        if (backgroundJobId && activeVoiceActionIdRef.current) {
          if (!ctx) return;
          const codexMessageId =
            activeCodexMsgIdRef.current || activeAssistantVoiceMsgIdRef.current;
          const task = stringValue(details?.task, summary) || "Codex is running the local task.";
          activeVoiceJobIdRef.current = backgroundJobId;
          updateAction(activeVoiceActionIdRef.current, {
            status: "running",
            detail: task,
            streamingResponse: task,
            workdir: workdir || voiceCtxRef.current?.project.path,
          });
          const actionId = activeVoiceActionIdRef.current;
          const chatId = ctx.chatId;
          const startedAt = Date.now();
          const updateCodexMessage = (patch: {
            text: string;
            streaming: boolean;
            status?: string;
            events?: CodexTimelineEvent[];
            artifacts?: ChatArtifact[];
            workdir?: string;
          }) => {
            if (!codexMessageId) return;
            store.updateMessage(chatId, codexMessageId, (message) => ({
              ...message,
              text: patch.text || message.text,
              streaming: patch.streaming,
              backgroundJobId,
              usedCodex: true,
              workdir: patch.workdir || message.workdir,
              codexEvents: patch.events || message.codexEvents || [],
              codexStatus: patch.status || message.codexStatus || "running",
              artifacts: appendArtifacts(message.artifacts, ...(patch.artifacts || [])),
            }));
          };
          updateCodexMessage({
            text: task,
            streaming: true,
            status: "running",
            workdir,
          });
          setActiveCodexJob({
            jobId: backgroundJobId,
            chatId,
            status: "running",
            task,
            message: task,
            startedAt,
            workdir,
          });
          const finishJob = () => {
            activeVoiceActionIdRef.current = null;
            activeVoiceJobIdRef.current = null;
            activeCodexMsgIdRef.current = null;
            setActiveCodexJob(null);
            onBackgroundJobSettled?.();
          };
          void watchCodexJob(backgroundJobId, {
            isCurrent: () => activeVoiceJobIdRef.current === backgroundJobId,
            onProgress: (job, progressText) => {
              updateCodexMessage({
                text: progressText,
                streaming: true,
                status: job.codex_status || "running",
                events: job.codex_events,
                workdir: job.workdir,
              });
              updateAction(actionId, {
                status: "running",
                streamingResponse: progressText,
                workdir: job.workdir || workdir || voiceCtxRef.current?.project.path,
              });
              setActiveCodexJob({
                jobId: backgroundJobId,
                chatId,
                status: job.status,
                task: job.task || task,
                message: progressText,
                startedAt,
                workdir: job.workdir || workdir,
              });
            },
            onDone: (job, finalText) => {
              updateCodexMessage({
                text: finalText,
                streaming: false,
                status: job.codex_status || "completed",
                events: job.codex_events,
                artifacts: job.artifacts,
                workdir: job.workdir,
              });
              updateAction(actionId, {
                status: "done",
                detail: job.task,
                streamingResponse: finalText,
                workdir: job.workdir || workdir || voiceCtxRef.current?.project.path,
              });
              addHandoff(name, finalText.slice(0, 160));
              finishJob();
            },
            onFailed: (job, failureText) => {
              updateCodexMessage({
                text: failureText,
                streaming: false,
                status: "failed",
                events: job.codex_events,
                workdir: job.workdir,
              });
              updateAction(actionId, {
                status: "failed",
                streamingResponse: failureText,
                workdir: job.workdir || workdir || voiceCtxRef.current?.project.path,
              });
              finishJob();
            },
            onError: (message) => {
              updateAction(actionId, { status: "failed", streamingResponse: message });
              updateCodexMessage({ text: message, streaming: false, status: "failed" });
              finishJob();
            },
          });
          return;
        }
        if (ctx) {
          const artifacts = details?.artifacts || [];
          const artifact = details?.artifact;
          const changeArtifact = details?.change_artifact;
          if (activeAssistantVoiceMsgIdRef.current) {
            store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
              ...m,
              text: summary || m.text,
              streaming: false,
              usedCodex: true,
              codexEvents: details?.codex_events || m.codexEvents || [],
              codexStatus: stringValue(details?.codex_status, m.codexStatus),
              codexTurnId: stringValue(details?.codex_turn_id, m.codexTurnId),
              codexThreadId: stringValue(details?.codex_thread_id, m.codexThreadId),
              artifacts: appendArtifacts(m.artifacts, ...artifacts, artifact, changeArtifact),
            }));
          } else {
            const id = crypto.randomUUID();
            activeAssistantVoiceMsgIdRef.current = id;
            store.appendMessage(ctx.chatId, {
              id,
              role: "assistant",
              text: "Codex finished the local work. The full output is available below while Vodex prepares the final response.",
              usedCodex: true,
              streaming: true,
              workdir,
              artifacts: appendArtifacts([], ...artifacts, artifact, changeArtifact),
              codexEvents: details?.codex_events || [],
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
          activeVoiceJobIdRef.current = null;
          activeCodexMsgIdRef.current = null;
          setActiveCodexJob(null);
          onBackgroundJobSettled?.();
        } else {
          addAction({
            title: "Vodex handoff to Codex",
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
