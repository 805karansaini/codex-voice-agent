import React, { useState } from "react";
import { Cpu, BracketsCurly, Terminal, SpeakerHigh, Broom } from "@phosphor-icons/react";
import { ActionEntry, Handoff, DebugEntry } from "../../types";
import ActionLogTab from "./ActionLogTab";
import HandoffsTab from "./HandoffsTab";
import DebugTab from "./DebugTab";
import VoiceTab from "./VoiceTab";

interface ContextPanelProps {
  actions: ActionEntry[];
  handoffs: Handoff[];
  debugEntries: DebugEntry[];
  voices: SpeechSynthesisVoice[];
  selectedVoiceURI: string;
  onSelectVoice: (uri: string) => void;
  pendingAudioUrl: string;
  playResponseAudio: (url: string) => void;
  onClear: () => void;
  hasActiveProject: boolean;
}

export const ContextPanel: React.FC<ContextPanelProps> = ({
  actions,
  handoffs,
  debugEntries,
  voices,
  selectedVoiceURI,
  onSelectVoice,
  pendingAudioUrl,
  playResponseAudio,
  onClear,
  hasActiveProject,
}) => {
  const [panelTab, setPanelTab] = useState<"actions" | "handoffs" | "debug" | "voice">("actions");

  return (
    <aside className="panel">
      <div className="panelHead">
        <h3>Console</h3>
        <button
          className="ghostBtn"
          type="button"
          onClick={onClear}
          aria-label="Clear conversation"
          disabled={!hasActiveProject}
          title="Clear history & logs"
        >
          <Broom size={15} weight="bold" />
        </button>
      </div>

      <div className="panelTabs" role="tablist" aria-label="Console views">
        <button
          className={`panelTabBtn ${panelTab === "actions" ? "active" : ""}`}
          onClick={() => setPanelTab("actions")}
          role="tab"
          aria-selected={panelTab === "actions"}
        >
          <Cpu size={14} weight="bold" />
          <span>Actions</span>
          {actions.length > 0 && <span className="tabBadge">{actions.length}</span>}
        </button>
        <button
          className={`panelTabBtn ${panelTab === "handoffs" ? "active" : ""}`}
          onClick={() => setPanelTab("handoffs")}
          role="tab"
          aria-selected={panelTab === "handoffs"}
        >
          <BracketsCurly size={14} weight="bold" />
          <span>Handoffs</span>
          {handoffs.length > 0 && <span className="tabBadge">{handoffs.length}</span>}
        </button>
        <button
          className={`panelTabBtn ${panelTab === "debug" ? "active" : ""}`}
          onClick={() => setPanelTab("debug")}
          role="tab"
          aria-selected={panelTab === "debug"}
        >
          <Terminal size={14} weight="bold" />
          <span>Debug</span>
        </button>
        <button
          className={`panelTabBtn ${panelTab === "voice" ? "active" : ""}`}
          onClick={() => setPanelTab("voice")}
          role="tab"
          aria-selected={panelTab === "voice"}
        >
          <SpeakerHigh size={14} weight="bold" />
          <span>Voice</span>
        </button>
      </div>

      <div className="panelContent">
        {panelTab === "actions" && <ActionLogTab actions={actions} />}
        {panelTab === "handoffs" && <HandoffsTab handoffs={handoffs} />}
        {panelTab === "debug" && <DebugTab debugEntries={debugEntries} />}
        {panelTab === "voice" && (
          <VoiceTab
            voices={voices}
            selectedVoiceURI={selectedVoiceURI}
            onSelectVoice={onSelectVoice}
            pendingAudioUrl={pendingAudioUrl}
            playResponseAudio={playResponseAudio}
          />
        )}
      </div>
    </aside>
  );
};
export default ContextPanel;
