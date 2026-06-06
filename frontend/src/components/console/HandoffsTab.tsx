import React from "react";
import { BracketsCurly, Terminal } from "@phosphor-icons/react";
import { Handoff } from "../../types";

interface HandoffsTabProps {
  handoffs: Handoff[];
}

export const HandoffsTab: React.FC<HandoffsTabProps> = ({ handoffs }) => {
  return (
    <div className="tabContentScroll">
      <div className="contentSectionHeader">
        <h4>Codex Handoffs</h4>
        <p>Tasks handed over to Codex by the Gemini Agent</p>
      </div>

      {handoffs.length === 0 ? (
        <div className="emptyPanelState">
          <BracketsCurly size={24} weight="duotone" />
          <p>No handoffs yet</p>
          <span>Tasks that require reading or writing files are delegated to Codex.</span>
        </div>
      ) : (
        <div className="handoffList">
          {handoffs.map((h) => (
            <div className="handoffItem" key={h.id}>
              <div className="handoffIcon">
                <Terminal size={14} weight="bold" />
              </div>
              <div className="handoffText">
                <b>{h.name}</b>
                <p>{h.summary}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
export default HandoffsTab;
