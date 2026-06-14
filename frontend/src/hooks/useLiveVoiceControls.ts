import { useCallback, useEffect } from "react";

import type { useLiveVoice } from "./useLiveVoice";
import type { useProjectStore } from "./useProjectStore";
import type { VoiceInputMode } from "./useVoiceInputMode";
import type { Project } from "../types";

type ProjectStore = ReturnType<typeof useProjectStore>;
type LiveVoice = ReturnType<typeof useLiveVoice>;
type VoiceContextRef = {
  current: { project: Project; chatId: string } | null;
};

type UseLiveVoiceControlsOptions = {
  store: ProjectStore;
  liveVoice: LiveVoice;
  voiceInputMode: VoiceInputMode;
  setVoiceInputMode: (mode: VoiceInputMode) => void;
  primeAudioPlayback: () => void;
  voiceCtxRef: VoiceContextRef;
  ensureVoiceContext: () => void;
  resetActiveVoiceMessages: () => void;
  stopActiveVoiceHandoff: (detail?: string) => void;
  setVoiceContext: (project: Project, chatId: string) => void;
  clearVoiceContext: () => void;
};

export function useLiveVoiceControls({
  store,
  liveVoice,
  voiceInputMode,
  setVoiceInputMode,
  primeAudioPlayback,
  voiceCtxRef,
  ensureVoiceContext,
  resetActiveVoiceMessages,
  stopActiveVoiceHandoff,
  setVoiceContext,
  clearVoiceContext,
}: UseLiveVoiceControlsOptions) {
  const voiceActive = liveVoice.active;
  const voiceContext = voiceCtxRef.current;
  const voiceContextChat = voiceContext
    ? (store.chats[voiceContext.project.id] || []).find((chat) => chat.id === voiceContext.chatId)
    : null;
  const voiceContextLabel = voiceContext
    ? `${voiceContext.project.name} / ${voiceContextChat?.title || "New chat"}`
    : "";

  useEffect(() => {
    if (!voiceActive) return;
    ensureVoiceContext();
  }, [ensureVoiceContext, voiceActive]);

  const holdToTalk = useCallback(() => {
    if (voiceInputMode !== "push" || !voiceActive) return;
    liveVoice.setMuted(false);
  }, [liveVoice, voiceActive, voiceInputMode]);

  const releaseToMute = useCallback(() => {
    if (voiceInputMode !== "push" || !voiceActive) return;
    liveVoice.setMuted(true);
  }, [liveVoice, voiceActive, voiceInputMode]);

  const toggleVoice = useCallback(() => {
    primeAudioPlayback();
    resetActiveVoiceMessages();
    if (voiceActive) {
      stopActiveVoiceHandoff("Stopped before completion.");
      liveVoice.stop();
      clearVoiceContext();
    } else if (store.activeProject) {
      const chatId = store.activeChatId || store.createChat(store.activeProject.id).id;
      setVoiceContext(store.activeProject, chatId);
      liveVoice.start();
      if (voiceInputMode === "push") {
        liveVoice.setMuted(true);
      }
    }
  }, [
    clearVoiceContext,
    liveVoice,
    primeAudioPlayback,
    resetActiveVoiceMessages,
    setVoiceContext,
    stopActiveVoiceHandoff,
    store,
    voiceActive,
    voiceInputMode,
  ]);

  const changeVoiceInputMode = useCallback(
    (nextMode: VoiceInputMode) => {
      setVoiceInputMode(nextMode);
      if (voiceActive) {
        liveVoice.setMuted(nextMode === "push");
      }
    },
    [liveVoice, setVoiceInputMode, voiceActive],
  );

  return {
    voiceActive,
    voiceContextLabel,
    holdToTalk,
    releaseToMute,
    toggleVoice,
    changeVoiceInputMode,
  };
}
