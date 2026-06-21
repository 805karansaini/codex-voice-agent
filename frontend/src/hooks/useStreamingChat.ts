import { useCallback } from "react";

import * as api from "../services/api";
import type { ActionEntry, ChatArtifact, CodexTimelineEvent, Project } from "../types";
import { appendArtifacts } from "../utils/artifacts";
import { readSseStream } from "../utils/sse";
import type { useProjectStore } from "./useProjectStore";

type ProjectStore = Pick<ReturnType<typeof useProjectStore>, "appendMessage" | "updateMessage">;

type ActionPatch = Partial<ActionEntry> | ((prev: ActionEntry) => Partial<ActionEntry>);

type UseStreamingChatOptions = {
  store: ProjectStore;
  activeAbortControllerRef: { current: AbortController | null };
  addAction: (action: Omit<ActionEntry, "id">) => string;
  updateAction: (id: string, patch: ActionPatch) => void;
  addHandoff: (name: string, summary: string) => void;
  speak: (text: string) => void;
  playResponseAudio: (audioUrl: string) => Promise<void>;
  setError: (message: string) => void;
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

export function useStreamingChat({
  store,
  activeAbortControllerRef,
  addAction,
  updateAction,
  addHandoff,
  speak,
  playResponseAudio,
  setError,
}: UseStreamingChatOptions) {
  const streamCodex = useCallback(
    async (task: string, project: Project, chatId: string, userMessageId: string) => {
      const actionId = addAction({
        title: "Background Codex task",
        status: "running",
        detail: task,
        workdir: project.path,
      });
      const assistantId = crypto.randomUUID();
      store.appendMessage(chatId, {
        id: assistantId,
        role: "assistant",
        text: "Started a background Codex task. I will update this message when it finishes.",
        usedCodex: true,
        streaming: true,
        workdir: project.path,
      });

      try {
        const queued = await api.enqueueCodexJob({
          task,
          workdir: project.path,
          projectId: project.id,
          chatId,
        });
        store.updateMessage(chatId, assistantId, (message) => ({
          ...message,
          backgroundJobId: queued.id,
        }));
        store.updateMessage(chatId, userMessageId, (message) => ({
          ...message,
          backgroundJobId: queued.id,
        }));
        updateAction(actionId, {
          detail: `${task}\n\nJob ${queued.id} is ${queued.status}.`,
          workdir: queued.workdir || project.path,
        });

        const pollJob = async () => {
          try {
            const job = await api.fetchCodexJob(queued.id);
            if (job.status === "queued" || job.status === "running") {
              const updates = job.progress_updates || [];
              const progressText =
                job.latest_status || updates[updates.length - 1] || "Codex is still working.";
              store.updateMessage(chatId, assistantId, (message) => ({
                ...message,
                text: progressText,
                codexEvents: job.codex_events || message.codexEvents || [],
                codexStatus: job.codex_status || message.codexStatus,
                codexTurnId: job.codex_turn_id || message.codexTurnId,
                codexThreadId: job.codex_thread_id || message.codexThreadId,
              }));
              updateAction(actionId, {
                status: "running",
                streamingResponse: progressText,
                workdir: job.workdir || project.path,
              });
              window.setTimeout(() => void pollJob(), 1500);
              return;
            }
            if (job.status === "done") {
              const finalText = job.result || "Codex background task completed.";
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
              updateAction(actionId, {
                status: "done",
                streamingResponse: finalText,
                workdir: job.workdir || project.path,
              });
              addHandoff("background_codex", finalText.slice(0, 160));
              speak(finalText);
              return;
            }
            const message = job.error || "Codex background task failed.";
            store.updateMessage(chatId, assistantId, (current) => ({
              ...current,
              streaming: false,
              text: message,
            }));
            updateAction(actionId, {
              status: "failed",
              streamingResponse: message,
            });
            setError(message);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to poll Codex job";
            updateAction(actionId, {
              status: "failed",
              streamingResponse: message,
            });
            setError(message);
          }
        };
        window.setTimeout(() => void pollJob(), 1000);
      } catch (err) {
        store.updateMessage(chatId, assistantId, (message) => ({
          ...message,
          streaming: false,
          text: message.text || "Codex request failed.",
        }));
        updateAction(actionId, {
          status: "failed",
          streamingResponse: err instanceof Error ? err.message : "Codex request failed",
        });
        throw err;
      } finally {
        activeAbortControllerRef.current = null;
      }
    },
    [activeAbortControllerRef, addAction, addHandoff, speak, store, updateAction, setError],
  );

  const streamAgent = useCallback(
    async (message: string, project: Project, chatId: string) => {
      const assistantId = crypto.randomUUID();
      store.appendMessage(chatId, {
        id: assistantId,
        role: "assistant",
        text: "",
        streaming: true,
      });

      const controller = new AbortController();
      activeAbortControllerRef.current = controller;
      let finalText = "";
      let finalAudioUrl = "";
      let usedCodex = false;
      let activeActionId = "";

      try {
        const res = await api.postChatStream(
          {
            message,
            workdir: project.path,
            projectId: project.id,
            chatId,
          },
          controller.signal,
        );

        if (!res.ok || !res.body) {
          const payload = await res.json().catch(() => ({}));
          store.updateMessage(chatId, assistantId, (current) => ({
            ...current,
            streaming: false,
            text: current.text || "Agent request failed.",
          }));
          throw new Error(payload.detail || "Agent request failed");
        }

        await readSseStream(res, (evt) => {
          if (evt.type === "codex_event" && evt.event) {
            const event = evt.event as CodexTimelineEvent;
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
            activeActionId = addAction({
              title: "Agent handoff to Codex",
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
              updateAction(activeActionId, (prev) => ({
                streamingResponse: (prev.streamingResponse || "") + evt.text,
              }));
            }
          } else if (evt.type === "tool_result") {
            usedCodex = true;
            const summary = String(evt.result || "").slice(0, 180);
            addHandoff(String(evt.name || "run_codex_task"), summary);
            store.updateMessage(chatId, assistantId, (current) => ({
              ...current,
              usedCodex: true,
              codexEvents: (evt.codex_events || current.codexEvents || []) as CodexTimelineEvent[],
              codexStatus: String(evt.codex_status || current.codexStatus || ""),
              codexTurnId: String(evt.codex_turn_id || current.codexTurnId || ""),
              codexThreadId: String(evt.codex_thread_id || current.codexThreadId || ""),
              artifacts: appendArtifacts(
                current.artifacts,
                evt.artifact as ChatArtifact | undefined,
                evt.change_artifact as ChatArtifact | undefined,
              ),
            }));
            if (activeActionId) {
              updateAction(activeActionId, {
                status: "done",
                workdir: String(evt.workdir || project.path),
              });
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
              codexEvents: (evt.codex_events || current.codexEvents || []) as CodexTimelineEvent[],
              codexStatus: String(evt.codex_status || current.codexStatus || ""),
              codexTurnId: String(evt.codex_turn_id || current.codexTurnId || ""),
              codexThreadId: String(evt.codex_thread_id || current.codexThreadId || ""),
            }));
          } else if (evt.type === "error") {
            store.updateMessage(chatId, assistantId, (current) => ({
              ...current,
              streaming: false,
              text: current.text || "Agent failed.",
            }));
            if (activeActionId) {
              updateAction(activeActionId, {
                status: "failed",
                streamingResponse: String(evt.message || "Agent failed"),
              });
            }
            setError(String(evt.message || "Agent failed"));
          }
        });

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
          }));
          if (activeActionId) {
            updateAction(activeActionId, {
              status: "failed",
              streamingResponse: "Cancelled by user.",
            });
          }
          return;
        }
        throw err;
      } finally {
        activeAbortControllerRef.current = null;
      }
    },
    [
      activeAbortControllerRef,
      addAction,
      addHandoff,
      playResponseAudio,
      speak,
      store,
      updateAction,
      setError,
    ],
  );

  return { streamAgent, streamCodex };
}
