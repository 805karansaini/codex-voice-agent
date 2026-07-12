import { useEffect, useState } from "react";

import { isOneOf, loadJSON, saveJSON } from "../utils/storage";

export type VoiceInputMode = "open" | "push";

const VOICE_INPUT_MODE_KEY = "cva.voiceInputMode.v1";

export function useVoiceInputMode() {
  const [voiceInputMode, setVoiceInputMode] = useState<VoiceInputMode>(() =>
    loadJSON(VOICE_INPUT_MODE_KEY, "open", isOneOf("open", "push")),
  );

  useEffect(() => {
    saveJSON(VOICE_INPUT_MODE_KEY, voiceInputMode);
  }, [voiceInputMode]);

  return { voiceInputMode, setVoiceInputMode };
}
