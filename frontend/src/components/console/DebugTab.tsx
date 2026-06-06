import React from "react";
import { Terminal } from "@phosphor-icons/react";
import { DebugEntry } from "../../types";

interface DebugTabProps {
  debugEntries: DebugEntry[];
}

export const DebugTab: React.FC<DebugTabProps> = ({ debugEntries }) => {
  return (
    <div className="tabContentScroll debugTab">
      <div className="contentSectionHeader">
        <h4>Live Debug Stream</h4>
        <p>Low-level websocket events and session logs</p>
      </div>

      {debugEntries.length === 0 ? (
        <div className="emptyPanelState">
          <Terminal size={24} weight="duotone" />
          <p>No debug events</p>
          <span>Go live with voice or send messages to see events.</span>
        </div>
      ) : (
        <div className="terminalLog">
          {debugEntries.map((e) => (
            <div className="logLine" key={e.id}>
              <span className="logTime">[{e.time}]</span>
              <span className="logMessage">{e.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
export default DebugTab;
