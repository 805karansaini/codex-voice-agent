import { useCallback } from "react";

import * as api from "../services/api";
import { watchCodexJob } from "../services/codexJobs";
import type { CodingHarness, Project } from "../types";
import { appendArtifacts } from "../utils/artifacts";
import { appendCodexEvent } from "../utils/codexEvents";
import { readSseStream } from "../utils/sse";
import type { useProjectStore } from "./useProjectStore";
import type { ConsoleWriter } from "./useConsoleSession";

type ProjectStore = Pick<ReturnType<typeof useProjectStore>, "appendMessage" | "updateMessage">;

type UseStreamingChatOptions = {
  store: ProjectStore;
  activeAbortControllerRef: { current: AbortController | null };
  consoleForChat: (chatId: string) => ConsoleWriter;
  speak: (text: string) => void;
  playResponseAudio: (audioUrl: string) => Promise<void>;
};

export function useStreamingChat({
  store,
  activeAbortControllerRef,
  consoleForChat,
  speak,
  playResponseAudio,
}: UseStreamingChatOptions) {
  const streamCodex = useCallback(
    async (
      task: string,
      project: Project,
      chatId: string,
      userMessageId: string,
      harness: CodingHarness,
      model?: string,
      reasoningEffort?: string,
      onBackgroundFailure?: (message: string) => void,
    ) => {
      const provider = harness === "claude" ? "Claude" : "Codex";
      const telemetry = consoleForChat(chatId);
      const actionId = telemetry.addAction({
        title: `Background ${provider} task`,
        status: "running",
        detail: task,
        workdir: project.path,
      });
      const assistantId = crypto.randomUUID();
      store.appendMessage(chatId, {
        id: assistantId,
        role: "assistant",
        text: `Started a background ${provider} task. I will update this message when it finishes.`,
        usedCodex: true,
        codingHarness: harness,
        streaming: true,
        workdir: project.path,
      });

      try {
        const queued = await api.enqueueCodexJob({
          task,
          workdir: project.path,
          projectId: project.id,
          chatId,
          harness,
          model,
          reasoningEffort,
        });
        store.updateMessage(chatId, assistantId, (message) => ({
          ...message,
          backgroundJobId: queued.id,
        }));
        store.updateMessage(chatId, userMessageId, (message) => ({
          ...message,
          backgroundJobId: queued.id,
        }));
        telemetry.updateAction(actionId, {
          detail: `${task}\n\nJob ${queued.id} is ${queued.status}.`,
          workdir: queued.workdir || project.path,
        });

        void watchCodexJob(queued.id, {
          isCurrent: telemetry.isValid,
          onProgress: (job, progressText) => {
            store.updateMessage(chatId, assistantId, (current) => ({
              ...current,
              text: progressText,
              codexEvents: job.codex_events || current.codexEvents || [],
              codexStatus: job.codex_status || current.codexStatus,
              codexTurnId: job.codex_turn_id || current.codexTurnId,
              codexThreadId: job.codex_thread_id || current.codexThreadId,
            }));
            telemetry.updateAction(actionId, {
              status: "running",
              streamingResponse: progressText,
              workdir: job.workdir || project.path,
            });
          },
          onDone: (job, finalText) => {
            store.updateMessage(chatId, assistantId, (message) => ({
              ...message,
              text: finalText,
              streaming: false,
              workdir: job.workdir,
              codexEvents: job.codex_events || message.codexEvents || [],
              codexStatus: job.codex_status || message.codexStatus,
              codexTurnId: job.codex_turn_id || message.codexTurnId,
              codexThreadId: job.codex_thread_id || message.codexThreadId,
              artifacts: appendArtifacts(message.artifacts, ...(job.artifacts || [])),
            }));
            telemetry.updateAction(actionId, {
              status: "done",
              streamingResponse: finalText,
              workdir: job.workdir || project.path,
            });
            telemetry.addHandoff("background_codex", finalText.slice(0, 160));
            speak(finalText);
          },
          onFailed: (_job, message) => {
            store.updateMessage(chatId, assistantId, (current) => ({
              ...current,
              streaming: false,
              text: message,
              codexStatus: "failed",
            }));
            telemetry.updateAction(actionId, { status: "failed", streamingResponse: message });
            onBackgroundFailure?.(message);
          },
          onError: (message) => {
            store.updateMessage(chatId, assistantId, (current) => ({
              ...current,
              streaming: false,
              text: current.text && !current.streaming ? current.text : message,
              codexStatus: "failed",
            }));
            telemetry.updateAction(actionId, { status: "failed", streamingResponse: message });
            onBackgroundFailure?.(message);
          },
        });
      } catch (err) {
        const failureMessage = err instanceof Error ? err.message : `${provider} request failed.`;
        store.updateMessage(chatId, assistantId, (message) => ({
          ...message,
          streaming: false,
          text: failureMessage,
          codexStatus: "failed",
        }));
        telemetry.updateAction(actionId, {
          status: "failed",
          streamingResponse: failureMessage,
        });
        throw err;
      } finally {
        activeAbortControllerRef.current = null;
      }
    },
    [activeAbortControllerRef, consoleForChat, speak, store],
  );

  const streamAgent = useCallback(
    async (
      message: string,
      project: Project,
      chatId: string,
      harness: CodingHarness,
      model?: string,
      reasoningEffort?: string,
    ) => {
      const telemetry = consoleForChat(chatId);
      const assistantId = crypto.randomUUID();
      store.appendMessage(chatId, {
        id: assistantId,
        role: "assistant",
        text: "",
        streaming: true,
        codingHarness: harness,
      });

      const controller = new AbortController();
      activeAbortControllerRef.current = controller;
      let finalText = "";
      let finalAudioUrl = "";
      let usedCodex = false;
      let activeActionId = "";
      let streamError = "";

      try {
        const res = await api.postChatStream(
          {
            message,
            workdir: project.path,
            projectId: project.id,
            chatId,
            harness,
            model,
            reasoningEffort,
          },
          controller.signal,
        );

        if (!res.ok || !res.body) {
          const payload: unknown = await res.json().catch(() => null);
          const detail =
            payload && typeof payload === "object" && "detail" in payload
              ? String(payload.detail)
              : undefined;
          store.updateMessage(chatId, assistantId, (current) => ({
            ...current,
            streaming: false,
            text: current.text || "Vodex request failed.",
          }));
          throw new Error(detail || "Vodex request failed");
        }

        const streamSummary = await readSseStream(res, (evt) => {
          if (evt.type === "codex_event" && evt.event) {
            const event = evt.event;
            store.updateMessage(chatId, assistantId, (current) => ({
              ...current,
              usedCodex: true,
              codexEvents: appendCodexEvent(current.codexEvents, event),
              codexStatus: String(event.status || current.codexStatus || ""),
              codexTurnId: String(event.turn_id || current.codexTurnId || ""),
              codexThreadId: String(event.thread_id || current.codexThreadId || ""),
            }));
          } else if (evt.type === "delta" && evt.text) {
            finalText += evt.text;
            store.updateMessage(chatId, assistantId, (current) => ({
              ...current,
              text: current.text + evt.text,
            }));
          } else if (evt.type === "tool_call") {
            usedCodex = true;
            activeActionId = telemetry.addAction({
              title: `Vodex handoff to ${harness === "claude" ? "Claude" : "Codex"}`,
              status: "running",
              detail: String(evt.task || "Local task"),
              streamingResponse: "",
              workdir: String(evt.workdir || project.path),
            });
            store.updateMessage(chatId, assistantId, (current) => ({
              ...current,
              usedCodex: true,
            }));
          } else if (evt.type === "tool_progress" && evt.text) {
            if (activeActionId) {
              telemetry.updateAction(activeActionId, (prev) => ({
                streamingResponse: (prev.streamingResponse || "") + evt.text,
              }));
            }
          } else if (evt.type === "tool_result") {
            usedCodex = true;
            const summary = String(evt.result || "").slice(0, 180);
            telemetry.addHandoff(String(evt.name || "run_codex_task"), summary);
            store.updateMessage(chatId, assistantId, (current) => ({
              ...current,
              usedCodex: true,
              codexEvents: evt.codex_events || current.codexEvents || [],
              codexStatus: String(evt.codex_status || current.codexStatus || ""),
              codexTurnId: String(evt.codex_turn_id || current.codexTurnId || ""),
              codexThreadId: String(evt.codex_thread_id || current.codexThreadId || ""),
              artifacts: appendArtifacts(current.artifacts, evt.artifact, evt.change_artifact),
            }));
            if (activeActionId) {
              telemetry.updateAction(activeActionId, {
                status: "done",
                workdir: String(evt.workdir || project.path),
              });
              activeActionId = "";
            }
          } else if (evt.type === "done") {
            finalText = String(evt.text ?? finalText);
            finalAudioUrl = String(evt.audio_data_url || "");
            usedCodex = usedCodex || (Array.isArray(evt.tool_calls) && evt.tool_calls.length > 0);
            store.updateMessage(chatId, assistantId, (current) => ({
              ...current,
              text: finalText || current.text || "Done.",
              streaming: false,
              usedCodex,
              workdir: evt.workdir || project.path,
              codexEvents: evt.codex_events || current.codexEvents || [],
              codexStatus: String(evt.codex_status || current.codexStatus || ""),
              codexTurnId: String(evt.codex_turn_id || current.codexTurnId || ""),
              codexThreadId: String(evt.codex_thread_id || current.codexThreadId || ""),
            }));
          } else if (evt.type === "error") {
            streamError = String(evt.message || "Vodex failed");
            store.updateMessage(chatId, assistantId, (current) => ({
              ...current,
              streaming: false,
              text: current.text || "Vodex failed.",
              codexStatus: usedCodex ? "failed" : current.codexStatus,
            }));
            if (activeActionId) {
              telemetry.updateAction(activeActionId, {
                status: "failed",
                streamingResponse: streamError,
              });
              activeActionId = "";
            }
          }
        });

        if (streamError) {
          throw new Error(streamError);
        }
        if (!streamSummary.receivedDone) {
          throw new Error(
            streamSummary.lastError || "Vodex connection ended before the response completed.",
          );
        }

        store.updateMessage(chatId, assistantId, (message) =>
          message.streaming ? { ...message, streaming: false } : message,
        );
        if (finalAudioUrl) await playResponseAudio(finalAudioUrl);
        else if (finalText) speak(finalText);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          store.updateMessage(chatId, assistantId, (message) => ({
            ...message,
            streaming: false,
            text: message.text || "Cancelled.",
            codexStatus: message.usedCodex ? "cancelled" : message.codexStatus,
          }));
          if (activeActionId) {
            telemetry.updateAction(activeActionId, {
              status: "failed",
              streamingResponse: "Cancelled by user.",
            });
            activeActionId = "";
          }
          return;
        }
        const message = err instanceof Error ? err.message : "Vodex request failed.";
        store.updateMessage(chatId, assistantId, (current) => ({
          ...current,
          streaming: false,
          text: current.text || message,
          codexStatus: current.usedCodex ? "failed" : current.codexStatus,
        }));
        if (activeActionId) {
          telemetry.updateAction(activeActionId, { status: "failed", streamingResponse: message });
          activeActionId = "";
        }
        throw err;
      } finally {
        activeAbortControllerRef.current = null;
      }
    },
    [activeAbortControllerRef, consoleForChat, playResponseAudio, speak, store],
  );

  return { streamAgent, streamCodex };
}
