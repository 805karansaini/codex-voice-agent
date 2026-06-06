import React from "react";
import { Cpu, Terminal } from "@phosphor-icons/react";
import { ActionEntry } from "../../types";

interface ActionLogTabProps {
  actions: ActionEntry[];
}

export const ActionLogTab: React.FC<ActionLogTabProps> = ({ actions }) => {
  return (
    <div className="tabContentScroll">
      <div className="contentSectionHeader">
        <h4>Action Log</h4>
        <p>Real-time status of local tasks executed by Codex</p>
      </div>

      {actions.length === 0 ? (
        <div className="emptyPanelState">
          <Cpu size={24} weight="duotone" />
          <p>No actions logged yet</p>
          <span>When Codex runs command-line operations, they will appear here.</span>
        </div>
      ) : (
        <div className="actionList">
          {actions.map((action) => (
            <div className={`actionItem ${action.status}`} key={action.id}>
              <div className="actionItemHeader">
                <span className={`actionStatusBadge ${action.status}`}>{action.status}</span>
                <span className="actionItemTime">Active</span>
              </div>
              <div className="actionText">
                <b>{action.title}</b>
                <p>{action.detail}</p>
                {action.workdir && (
                  <div className="actionWorkdir">
                    <Terminal size={10} />
                    <code>{action.workdir}</code>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
export default ActionLogTab;
