import { useEffect, useState } from "react";

import { loadJSON, saveJSON } from "../utils";

export type VoiceInputMode = "open" | "push";

const VOICE_INPUT_MODE_KEY = "cva.voiceInputMode.v1";

export function useVoiceInputMode() {
  const [voiceInputMode, setVoiceInputMode] = useState<VoiceInputMode>(() =>
    loadJSON<VoiceInputMode>(VOICE_INPUT_MODE_KEY, "open"),
  );

  useEffect(() => {
    saveJSON(VOICE_INPUT_MODE_KEY, voiceInputMode);
  }, [voiceInputMode]);

  return { voiceInputMode, setVoiceInputMode };
}
