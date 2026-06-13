import { useCallback, useState } from "react";

export type ConsoleTabId = "stream" | "actions" | "handoffs" | "voice";

export function useConsolePanelState() {
  const [activeConsoleTab, setActiveConsoleTab] = useState<ConsoleTabId>("stream");

  const openVoiceTab = useCallback(() => {
    setActiveConsoleTab("voice");
  }, []);

  return { activeConsoleTab, setActiveConsoleTab, openVoiceTab };
}
