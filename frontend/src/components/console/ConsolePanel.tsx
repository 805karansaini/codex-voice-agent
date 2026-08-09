import type {
  ActionEntry,
  CodingHarnessInfo,
  DebugEntry,
  DoctorCheck,
  Handoff,
  Message,
} from "../../types";
import type { ConsoleTabId } from "../../hooks/useConsolePanelState";
import type { BackendStatus } from "../../hooks/useBackendStatus";
import type { VoiceInputMode } from "../../hooks/useVoiceInputMode";
import { cn } from "../../utils";
import ConsoleActionsPanel from "./ConsoleActionsPanel";
import ConsoleHandoffsPanel from "./ConsoleHandoffsPanel";
import ConsoleHeader from "./ConsoleHeader";
import ConsoleStatsFooter from "./ConsoleStatsFooter";
import ConsoleStreamPanel from "./ConsoleStreamPanel";
import ConsoleTabs from "./ConsoleTabs";
import ConsoleVoicePanel from "./ConsoleVoicePanel";

type ConsolePanelProps = {
  isMobile: boolean;
  width: number;
  status: BackendStatus;
  canClear: boolean;
  activeTab: ConsoleTabId;
  debugEntries: DebugEntry[];
  actions: ActionEntry[];
  handoffs: Handoff[];
  messages: Message[];
  codingHarnesses: CodingHarnessInfo[];
  doctorChecks: DoctorCheck[];
  voices: SpeechSynthesisVoice[];
  selectedVoiceURI: string;
  voiceInputMode: VoiceInputMode;
  pendingAudioUrl: string;
  onHide: () => void;
  onBackToChat: () => void;
  onClear: () => void;
  onTabChange: (tab: ConsoleTabId) => void;
  onRefreshDoctor: () => void;
  onSelectedVoiceChange: (voiceURI: string) => void;
  onVoiceInputModeChange: (mode: VoiceInputMode) => void;
  onPlayResponseAudio: (audioUrl: string) => void;
};

export default function ConsolePanel({
  isMobile,
  width,
  status,
  canClear,
  activeTab,
  debugEntries,
  actions,
  handoffs,
  messages,
  codingHarnesses,
  doctorChecks,
  voices,
  selectedVoiceURI,
  voiceInputMode,
  pendingAudioUrl,
  onHide,
  onBackToChat,
  onClear,
  onTabChange,
  onRefreshDoctor,
  onSelectedVoiceChange,
  onVoiceInputModeChange,
  onPlayResponseAudio,
}: ConsolePanelProps) {
  return (
    <aside
      style={isMobile ? { width: "100%" } : { width: `${width}px` }}
      className={cn(
        "flex h-full min-h-0 flex-col bg-surface-1 shrink-0",
        !isMobile ? "border-l border-line" : "w-full",
      )}
    >
      <ConsoleHeader
        isMobile={isMobile}
        status={status}
        canClear={canClear}
        onHide={onHide}
        onBackToChat={onBackToChat}
        onClear={onClear}
      />

      <ConsoleTabs isMobile={isMobile} activeTab={activeTab} onChange={onTabChange} />

      <div className="flex-1 overflow-y-auto p-3.5">
        {activeTab === "stream" && <ConsoleStreamPanel entries={debugEntries} />}

        {activeTab === "actions" && <ConsoleActionsPanel actions={actions} />}

        {activeTab === "handoffs" && <ConsoleHandoffsPanel handoffs={handoffs} />}

        {activeTab === "voice" && (
          <ConsoleVoicePanel
            isMobile={isMobile}
            codingHarnesses={codingHarnesses}
            doctorChecks={doctorChecks}
            voices={voices}
            selectedVoiceURI={selectedVoiceURI}
            voiceInputMode={voiceInputMode}
            pendingAudioUrl={pendingAudioUrl}
            onRefreshDoctor={onRefreshDoctor}
            onSelectedVoiceChange={onSelectedVoiceChange}
            onVoiceInputModeChange={onVoiceInputModeChange}
            onPlayResponseAudio={onPlayResponseAudio}
          />
        )}
      </div>

      <ConsoleStatsFooter messages={messages} />
    </aside>
  );
}
