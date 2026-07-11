import { useCallback, useEffect, useReducer, useState } from "react";

import type { LiveVoiceState } from "../types";

type VoiceStatus = {
  state: LiveVoiceState;
  message: string;
};

type VoiceStatusAction =
  | { type: "transition"; state: LiveVoiceState; message: string }
  | { type: "describe"; message: string };

function reduceVoiceStatus(current: VoiceStatus, action: VoiceStatusAction): VoiceStatus {
  if (action.type === "describe") return { ...current, message: action.message };
  return { state: action.state, message: action.message };
}

export function useLiveVoiceStatus() {
  const [{ state, message }, dispatch] = useReducer(reduceVoiceStatus, {
    state: "idle",
    message: "Gemini Live voice is ready.",
  });
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (state !== "working") {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const interval = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [state]);

  const transition = useCallback((next: LiveVoiceState, nextMessage: string) => {
    dispatch({ type: "transition", state: next, message: nextMessage });
  }, []);
  const describe = useCallback((nextMessage: string) => {
    dispatch({ type: "describe", message: nextMessage });
  }, []);

  return { state, message, elapsed, transition, describe };
}
