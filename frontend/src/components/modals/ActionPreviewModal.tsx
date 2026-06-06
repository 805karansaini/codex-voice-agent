import React, { useEffect } from "react";
import { Plugs } from "@phosphor-icons/react";
import { PendingAction } from "../../types";

interface ActionPreviewModalProps {
  action: PendingAction;
  onCancel: () => void;
  onRun: () => void;
}

export const ActionPreviewModal: React.FC<ActionPreviewModalProps> = ({
  action,
  onCancel,
  onRun,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onRun();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onRun]);

  return (
    <div className="overlay" onMouseDown={onCancel}>
      <div className="modal actionPreview" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modalHead">
          <h3>Review before running</h3>
          <p>This task may change the selected folder. Check the target before continuing.</p>
        </div>
        <div className="modalBody">
          <div className="previewWarning">
            <Plugs size={16} weight="bold" />
            <span>{action.reason}</span>
          </div>
          <div className="previewGrid">
            <div>
              <span>Project</span>
              <b>{action.project.name}</b>
            </div>
            <div>
              <span>Mode</span>
              <b>{action.mode === "codex" ? "Codex direct" : "Agent"}</b>
            </div>
            <div className="wide">
              <span>Working folder</span>
              <code>{action.project.path}</code>
            </div>
          </div>
          <div className="previewTask">
            <span>Task</span>
            <p>{action.text}</p>
          </div>
        </div>
        <div className="modalFoot">
          <button className="btnGhost" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="btnPrimary dangerRun" type="button" onClick={onRun}>
            Run in this folder
          </button>
        </div>
      </div>
    </div>
  );
};
export default ActionPreviewModal;
